import Foundation
import UIKit
import Capacitor
import UniformTypeIdentifiers

// Access is confined to the directory explicitly selected in Apple's Files picker.
// No filesystem paths are ever sent to the web UI or to the Bridge backend.
@objc(FreePTIOSFiles)
public class FreePTIOSFiles: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FreePTIOSFiles"
    public let jsName = "BridgeIOSFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    private let bookmarkKey = "freept.ios.files.bookmark.v1"
    private var pendingCall: CAPPluginCall?
    private var handles: [String: URL] = [:]
    private var scopedRoot: URL?
    private let maxHandles = 10000
    private let pageSize = 100
    private let maxChunk = 262144

    deinit { scopedRoot?.stopAccessingSecurityScopedResource() }

    // Resolve only an existing security-scoped bookmark. No fallback to the whole device.
    private func rootURL() -> URL? {
        if let active = scopedRoot { return active }
        guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
              !stale, url.startAccessingSecurityScopedResource() else { return nil }
        scopedRoot = url
        handles = ["root": url]
        return url
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["granted": rootURL() != nil])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingCall == nil else {
                call.reject("picker_busy")
                return
            }
            guard let controller = self.bridge?.viewController else {
                call.reject("no_view_controller")
                return
            }
            self.pendingCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            picker.allowsMultipleSelection = false
            picker.delegate = self
            controller.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["granted": false])
        pendingCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let url = urls.first, url.startAccessingSecurityScopedResource() else {
            call.resolve(["granted": false])
            return
        }
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            // A previously consented directory is replaced, not added silently.
            scopedRoot?.stopAccessingSecurityScopedResource()
            scopedRoot = url
            handles = ["root": url]
            UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
            call.resolve(["granted": true])
        } catch {
            url.stopAccessingSecurityScopedResource()
            call.reject("directory_authorization_failed")
        }
    }

    private func authorizedURL(_ handle: String) throws -> URL {
        guard let root = rootURL(), let url = handles[handle] else { throw NSError(domain: "FreePTIOS", code: 1) }
        // Prevent symlink escapes and unauthorized path substitution.
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        guard path == base || path.hasPrefix(base + "/") else { throw NSError(domain: "FreePTIOS", code: 2) }
        return url
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle"), let offset = call.getInt("offset"),
              offset >= 0 && offset <= 10000 else {
            call.reject("invalid_request")
            return
        }
        do {
            if handle == "root" {
                guard let root = rootURL() else { throw NSError(domain: "FreePTIOS", code: 5) }
                let identifier = "11111111-1111-4111-8111-111111111112"
                handles[identifier] = root
                call.resolve(["entries": [[
                    "handle": identifier,
                    "name": root.lastPathComponent,
                    "directory": true, "size": -1,
                    "mime": "vnd.android.document/directory"
                ]], "nextOffset": -1])
                return
            }
            let directory = try authorizedURL(handle)
            let coordinator = NSFileCoordinator(filePresenter: nil)
            var coordinatorError: NSError?
            var result: [[String: Any]] = []
            var nextOffset = -1
            var readingError: Error?
            coordinator.coordinate(readingItemAt: directory, options: [], error: &coordinatorError) { scoped in
                do {
                    let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .nameKey, .contentTypeKey]
                    let urls = try FileManager.default.contentsOfDirectory(at: scoped, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants])
                        .filter { url in (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true }
                        .sorted { left, right in
                            let a = (try? left.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                            let b = (try? right.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                            return a == b ? left.lastPathComponent.localizedStandardCompare(right.lastPathComponent) == .orderedAscending : a
                        }
                    let page = Array(urls.dropFirst(offset).prefix(self.pageSize))
                    for url in page {
                        let props = try url.resourceValues(forKeys: Set(keys))
                        let name = url.lastPathComponent
                        guard !name.isEmpty && name != "." && name != ".." &&
                              name.utf16.count <= 255 && !name.contains("/") && !name.contains("\\") &&
                              !name.unicodeScalars.contains(where: { $0.value < 32 }) else { continue }
                        let resolved = url.resolvingSymlinksInPath().standardizedFileURL.path
                        let base = self.scopedRoot!.resolvingSymlinksInPath().standardizedFileURL.path
                        guard resolved.hasPrefix(base + "/") else { continue }
                        guard self.handles.count < self.maxHandles else { throw NSError(domain: "FreePTIOS", code: 3) }
                        let identifier = UUID().uuidString.lowercased()
                        self.handles[identifier] = url
                        let isFolder = props.isDirectory ?? false
                        result.append([
                            "handle": identifier, "name": name,
                            "directory": isFolder,
                            "size": isFolder ? -1 : max(0, props.fileSize ?? 0),
                            "mime": isFolder ? "vnd.android.document/directory" : (props.contentType?.preferredMIMEType ?? "application/octet-stream")
                        ])
                    }
                    if offset + page.count < urls.count { nextOffset = offset + page.count }
                } catch { readingError = error }
            }
            if let error = coordinatorError ?? (readingError as NSError?) { throw error }
            call.resolve(["entries": result, "nextOffset": nextOffset])
        } catch {
            call.reject("directory_unavailable")
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle"), handle != "root",
              let offset = call.getInt("offset"), let length = call.getInt("length"),
              offset >= 0, length > 0 && length <= maxChunk else {
            call.reject("invalid_read")
            return
        }
        do {
            let url = try authorizedURL(handle)
            let props = try url.resourceValues(forKeys: [.isRegularFileKey])
            guard props.isRegularFile == true else { throw NSError(domain: "FreePTIOS", code: 4) }
            let stream = try FileHandle(forReadingFrom: url)
            defer { try? stream.close() }
            try stream.seek(toOffset: UInt64(offset))
            let data = try stream.read(upToCount: length) ?? Data()
            call.resolve(["base64": data.base64EncodedString(), "bytesRead": data.count, "eof": data.count < length])
        } catch {
            call.reject("file_unavailable")
        }
    }
}

public class FreePTIOSBridgeViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FreePTIOSFiles())
    }
}
