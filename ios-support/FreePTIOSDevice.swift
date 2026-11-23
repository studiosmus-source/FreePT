import Foundation
import Capacitor
import Security

// Native-only staging relay: keeps the device secret in iOS Keychain, not JS
// storage. Jobs and chunks use the existing authorized HTTPS Bridge protocol.
@objc(FreePTIOSDevice)
public class FreePTIOSDevice: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FreePTIOSDevice"
    public let jsName = "BridgeIOSDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "provision", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "poll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "respond", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise)
    ]

    private let service = "it.freept.ios.bridge.staging"
    private let account = "device"
    private let endpoint = URL(string: "https://freept-bridge-staging.onrender.com")!
    private let tokenPattern = "^[0-9a-f]{64}$"
    private let uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    private var sessionToken: String?
    private var pendingJob: [String: Any]?
    private var pendingOperation: String?
    private var activeDeviceId: String?

    private func valid(_ value: String, pattern: String) -> Bool {
        value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
    private func keychainQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    private func credentials() -> [String: String]? {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let saved = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let id = saved["deviceId"], let secret = saved["deviceSecret"],
              valid(id, pattern: uuidPattern), valid(secret, pattern: tokenPattern) else { return nil }
        return saved
    }

    @objc func status(_ call: CAPPluginCall) {
        if let cred = credentials() {
            call.resolve(["provisioned": true, "deviceId": cred["deviceId"]!])
        } else {
            call.resolve(["provisioned": false])
        }
    }
    @objc func provision(_ call: CAPPluginCall) {
        guard let id = call.getString("deviceId"),
              let secret = call.getString("deviceSecret"),
              valid(id, pattern: uuidPattern),
              valid(secret, pattern: tokenPattern) else {
            call.reject("invalid_credentials")
            return
        }
        guard credentials() == nil else {
            call.reject("device_already_provisioned")
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["deviceId": id, "deviceSecret": secret]) else {
            call.reject("invalid_credentials")
            return
        }
        var query = keychainQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            call.reject("credential_store_failed")
            return
        }
        call.resolve(["saved": true])
    }
    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(keychainQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("credential_clear_failed")
            return
        }
        sessionToken = nil
        pendingJob = nil
        pendingOperation = nil
        activeDeviceId = nil
        call.resolve(["cleared": true])
    }

    private func post(_ path: String, _ json: [String: Any]) async throws -> [String: Any] {
        guard path.hasPrefix("/bridge/tx/"),
              let url = URL(string: path, relativeTo: endpoint)?.absoluteURL,
              url.scheme == "https", url.host == endpoint.host else {
            throw NSError(domain: "FreePTIOS", code: 30)
        }
        let data = try JSONSerialization.data(withJSONObject: json)
        guard data.count <= (path.hasSuffix("/chunk") ? 360000 : 48000) else {
            throw NSError(domain: "FreePTIOS", code: 31)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 32
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 32
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let (responseData, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              responseData.count <= 65536,
              let body = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw NSError(domain: "FreePTIOS", code: 32)
        }
        return body
    }
    private func authenticated() throws -> (String, String) {
        guard let device = activeDeviceId, let token = sessionToken else {
            throw NSError(domain: "FreePTIOS", code: 33)
        }
        return (device, token)
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let cred = credentials(), let id = cred["deviceId"],
              let secret = cred["deviceSecret"] else {
            call.reject("device_not_provisioned")
            return
        }
        Task {
            do {
                let result = try await post("/bridge/tx/connect", ["deviceId": id, "deviceSecret": secret])
                guard let token = result["token"] as? String,
                      valid(token, pattern: tokenPattern) else {
                    throw NSError(domain: "FreePTIOS", code: 34)
                }
                self.activeDeviceId = id
                self.sessionToken = token
                self.pendingJob = nil
                self.pendingOperation = nil
                call.resolve(["connected": true])
            } catch { call.reject("bridge_connection_failed") }
        }
    }
    @objc func poll(_ call: CAPPluginCall) {
        do {
            let (id, token) = try authenticated()
            if let job = pendingJob { call.resolve(["job": job]); return }
            Task {
                do {
                    let body = try await post("/bridge/tx/poll", ["deviceId": id, "sessionToken": token])
                    guard let job = body["job"] else {
                        call.resolve(["job": NSNull()])
                        return
                    }
                    guard let details = job as? [String: Any],
                          let target = details["deviceId"] as? String, target == id,
                          let jobId = details["jobId"] as? String,
                          valid(jobId, pattern: uuidPattern),
                          let operation = details["operation"] as? String,
                          ["list", "browse", "read"].contains(operation) else {
                        throw NSError(domain: "FreePTIOS", code: 35)
                    }
                    self.pendingJob = details
                    self.pendingOperation = operation
                    call.resolve(["job": details])
                } catch { call.reject("bridge_poll_failed") }
            }
        } catch { call.reject("bridge_not_connected") }
    }
    @objc func respond(_ call: CAPPluginCall) {
        do {
            let (id, token) = try authenticated()
            guard let job = pendingJob,
                  let jobId = job["jobId"] as? String,
                  let operation = pendingOperation,
                  let receivedId = call.getString("jobId"), receivedId == jobId else {
                call.reject("job_mismatch")
                return
            }
            var body: [String: Any] = ["deviceId": id, "sessionToken": token, "jobId": jobId]
            let path: String
            if operation == "read" {
                guard let chunk = call.getObject("chunk"),
                      chunk["base64"] is String, chunk["bytesRead"] is Int,
                      chunk["eof"] is Bool else {
                    call.reject("invalid_chunk")
                    return
                }
                path = "/bridge/tx/chunk"
                body["chunk"] = chunk
            } else {
                guard let entries = call.getArray("entries") else {
                    call.reject("invalid_entries")
                    return
                }
                body["entries"] = entries
                if operation == "browse" {
                    guard let offset = call.getInt("nextOffset") else {
                        call.reject("invalid_offset")
                        return
                    }
                    body["nextOffset"] = offset
                    path = "/bridge/tx/browse"
                } else {
                    path = "/bridge/tx/folder"
                }
            }
            Task {
                do {
                    let answer = try await post(path, body)
                    guard answer["jobId"] as? String == jobId,
                          answer["deviceId"] as? String == id,
                          answer["state"] as? String == "done" else {
                        throw NSError(domain: "FreePTIOS", code: 36)
                    }
                    self.pendingJob = nil
                    self.pendingOperation = nil
                    call.resolve(["done": true])
                } catch { call.reject("bridge_response_failed") }
            }
        } catch { call.reject("bridge_not_connected") }
    }
    @objc func disconnect(_ call: CAPPluginCall) {
        sessionToken = nil
        pendingJob = nil
        pendingOperation = nil
        activeDeviceId = nil
        call.resolve(["disconnected": true])
    }
}
