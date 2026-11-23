// Native iOS Bridge: only user-picked security-scoped folders; foreground only.
// No whole-device permission, arbitrary paths, or unattended background execution.
import UIKit
import Capacitor
import UniformTypeIdentifiers
import Security

private enum FreePTIOS {
    static let endpoint = "https://freept-bridge-staging.onrender.com"
    static let bookmark = "freept.ios.shared.folder.bookmark"
    static let keychain = "it.freept.ios.user.bridge.device"
    static let paused = "freept.ios.bridge.paused"
    static let maxEntries = 10000
}

private final class IOSFolder {
    static let shared = IOSFolder()
    private var handles: [String: URL] = [:]
    private var selected: URL?
    private func resolve() -> URL? {
        if let selected { return selected }
        guard let bytes = UserDefaults.standard.data(forKey: FreePTIOS.bookmark) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bytes, options: [],
                                 relativeTo: nil, bookmarkDataIsStale: &stale),
              !stale else { return nil }
        selected = url
        handles = ["root": url]
        return url
    }
    func allowed() -> Bool {
        guard let url = resolve() else { return false }
        let opened = url.startAccessingSecurityScopedResource()
        if opened { url.stopAccessingSecurityScopedResource() }
        return opened
    }
    func select(_ url: URL) throws {
        guard url.hasDirectoryPath, url.startAccessingSecurityScopedResource() else {
            throw NSError(domain: "ios_folder_not_accessible", code: 1)
        }
        defer { url.stopAccessingSecurityScopedResource() }
        let bytes = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(bytes, forKey: FreePTIOS.bookmark)
        selected = url
        handles = ["root":url]
    }
    private func secure(_ handle: String) throws -> (URL, URL, Bool) {
        guard let root = resolve(), let item = handles[handle] else {
            throw NSError(domain: "ios_invalid_handle", code: 1)
        }
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        let path = item.standardizedFileURL.resolvingSymlinksInPath().path
        guard path == rootPath || path.hasPrefix(rootPath + "/") else {
            throw NSError(domain: "ios_path_outside_share", code: 1)
        }
        let started = root.startAccessingSecurityScopedResource()
        guard started else { throw NSError(domain:"ios_scope_expired",code:1) }
        return (root,item,started)
    }
    func list(_ handle: String, _ offset: Int) throws -> [String: Any] {
        guard offset >= 0 && offset <= FreePTIOS.maxEntries else {
            throw NSError(domain:"ios_invalid_offset",code:1)
        }
        let (root, folder, _) = try secure(handle)
        defer { root.stopAccessingSecurityScopedResource() }
        let props: [URLResourceKey] = [.isDirectoryKey,.isSymbolicLinkKey,.fileSizeKey]
        var children = try FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: props, options: [])
        children = children.filter { item in
            guard let info = try? item.resourceValues(forKeys: Set(props)),
                  info.isSymbolicLink != true else { return false }
            let name=item.lastPathComponent
            guard name.utf16.count > 0 && name.utf16.count <= 255,
                  !name.contains("/") && !name.contains("\\"),
                  !name.unicodeScalars.contains(where: {$0.value < 32 || $0.value == 127})
            else { return false }
            let base = root.standardizedFileURL.resolvingSymlinksInPath().path
            let path = item.standardizedFileURL.resolvingSymlinksInPath().path
            guard path.hasPrefix(base + "/") else { return false }
            if info.isDirectory == true { return true }
            return (info.fileSize ?? 0) <= 1_099_511_627_776
        }
        children.sort { a,b in
            let ad=(try? a.resourceValues(forKeys:[.isDirectoryKey]).isDirectory)==true
            let bd=(try? b.resourceValues(forKeys:[.isDirectoryKey]).isDirectory)==true
            if ad != bd { return ad }
            let cmp=a.lastPathComponent.localizedStandardCompare(b.lastPathComponent)
            return cmp == .orderedAscending
        }
        if children.count > FreePTIOS.maxEntries {
            throw NSError(domain:"ios_folder_too_large",code:1)
        }
        let slice=Array(children.dropFirst(offset).prefix(100))
        var data:[[String:Any]]=[]
        for url in slice {
            let info=try url.resourceValues(forKeys: [.isDirectoryKey,.fileSizeKey])
            let directory=info.isDirectory == true
            let found=handles.first(where:{$0.value == url})?.key
            let handle=found ?? UUID().uuidString.lowercased()
            handles[handle]=url
            data.append(["handle":handle,"name":url.lastPathComponent,
                         "directory":directory,
                         "size":directory ? -1 : (info.fileSize ?? 0),
                         "mime":directory ? "vnd.android.document/directory" : "application/octet-stream"])
        }
        let next=offset + slice.count < children.count ? offset + slice.count : -1
        return ["entries":data,"nextOffset":next]
    }
    func read(_ handle: String, _ offset: Int, _ length: Int) throws -> [String:Any] {
        guard offset >= 0 && offset <= 1_099_511_627_776,
              length > 0 && length <= 32768 else {
            throw NSError(domain:"ios_invalid_read",code:1)
        }
        let (root, file, _) = try secure(handle)
        defer { root.stopAccessingSecurityScopedResource() }
        let values=try file.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey,.fileSizeKey])
        guard values.isDirectory != true && values.isSymbolicLink != true,
              (values.fileSize ?? 0) <= 1_099_511_627_776 else {
            throw NSError(domain:"ios_file_not_shared",code:1)
        }
        let input=try FileHandle(forReadingFrom:file)
        defer { try? input.close() }
        try input.seek(toOffset: UInt64(offset))
        let bytes=try input.read(upToCount:length) ?? Data()
        return ["base64":bytes.base64EncodedString(),"bytesRead":bytes.count,
                "eof":offset+bytes.count >= (values.fileSize ?? 0)]
    }
}

private enum IOSCredential {
    static func read() -> [String:String]? {
        let request:[String:Any] = [
            kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:FreePTIOS.keychain,
            kSecAttrAccount as String:"bridge",
            kSecReturnData as String:true,
            kSecMatchLimit as String:kSecMatchLimitOne
        ]
        var result:CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary,&result)==errSecSuccess,
              let bytes=result as? Data,
              let value=try? JSONSerialization.jsonObject(with:bytes) as? [String:String] else {
            return nil
        }
        return value
    }
    static func save(_ id:String,_ secret:String) -> Bool {
        guard read()==nil,let data=try? JSONSerialization.data(
            withJSONObject:["deviceId":id,"deviceSecret":secret]) else { return false }
        let attributes:[String:Any]=[
            kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:FreePTIOS.keychain,
            kSecAttrAccount as String:"bridge",
            kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String:data
        ]
        return SecItemAdd(attributes as CFDictionary,nil)==errSecSuccess
    }
    static func clear() {
        let query:[String:Any]=[
            kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:FreePTIOS.keychain,
            kSecAttrAccount as String:"bridge"
        ]
        SecItemDelete(query as CFDictionary)
    }
}
private enum IOSNet {
    static func request(_ route:String,_ payload:[String:Any],bearer:String?=nil) async throws -> [String:Any] {
        guard let url=URL(string:FreePTIOS.endpoint+route),
              url.scheme=="https", url.host=="freept-bridge-staging.onrender.com" else {
            throw NSError(domain:"ios_invalid_endpoint",code:1)
        }
        var req=URLRequest(url:url)
        req.httpMethod="POST"
        req.timeoutInterval=24
        req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let bearer { req.setValue("Bearer "+bearer,forHTTPHeaderField:"Authorization") }
        req.httpBody=try JSONSerialization.data(withJSONObject:payload)
        let (response,meta)=try await URLSession.shared.data(for:req)
        guard let http=meta as? HTTPURLResponse,(200..<300).contains(http.statusCode),
              let dict=try JSONSerialization.jsonObject(with:response) as? [String:Any] else {
            throw NSError(domain:"ios_bridge_request_denied",code:1)
        }
        return dict
    }
}

@objc(BridgeFiles)
public class IOSBridgeFiles: CAPPlugin,CAPBridgedPlugin {
    public let identifier="BridgeFiles"
    public let jsName="BridgeFiles"
    public let pluginMethods:[CAPPluginMethod]=[]
}
@objc(BridgeAllFiles)
public class IOSBridgeFolder: CAPPlugin,CAPBridgedPlugin,UIDocumentPickerDelegate {
    public let identifier="BridgeAllFiles"
    public let jsName="BridgeAllFiles"
    public let pluginMethods:[CAPPluginMethod]=[
        CAPPluginMethod(name:"status",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"requestPermission",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"list",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"readChunk",returnType:CAPPluginReturnPromise)
    ]
    private var selection:CAPPluginCall?
    @objc func status(_ call:CAPPluginCall) {
        call.resolve(["granted":IOSFolder.shared.allowed()])
    }
    @objc func requestPermission(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.selection == nil else { call.reject("ios_picker_busy");return }
            self.selection=call
            let picker=UIDocumentPickerViewController(forOpeningContentTypes:[.folder],asCopy:false)
            picker.allowsMultipleSelection=false
            picker.delegate=self
            self.bridge?.viewController?.present(picker,animated:true)
        }
    }
    public func documentPicker(_ controller:UIDocumentPickerViewController,didPickDocumentsAt urls:[URL]) {
        guard let call=selection else {return}
        selection=nil
        do {
            guard let url=urls.first else { call.resolve(["granted":false]);return }
            try IOSFolder.shared.select(url)
            call.resolve(["granted":true])
        } catch { call.reject("ios_folder_not_accessible") }
    }
    public func documentPickerWasCancelled(_ controller:UIDocumentPickerViewController) {
        selection?.resolve(["granted":false]);selection=nil
    }
    @objc func list(_ call:CAPPluginCall) {
        do {
            let result=try IOSFolder.shared.list(
                call.getString("handle") ?? "root", call.getInt("offset") ?? 0)
            call.resolve(result)
        }catch { call.reject("ios_folder_unavailable") }
    }
    @objc func readChunk(_ call:CAPPluginCall) {
        do {
            let result=try IOSFolder.shared.read(call.getString("handle") ?? "",
                        call.getInt("offset") ?? -1, call.getInt("length") ?? 0)
            call.resolve(result)
        }catch{ call.reject("ios_file_unavailable") }
    }
}
@objc(BridgeCredentials)
public class IOSBridgeCredentials: CAPPlugin,CAPBridgedPlugin {
    public let identifier="BridgeCredentials"
    public let jsName="BridgeCredentials"
    public let pluginMethods:[CAPPluginMethod]=[
        CAPPluginMethod(name:"status",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"provision",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"clear",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"ownerRequest",returnType:CAPPluginReturnPromise)
    ]
    @objc func status(_ call:CAPPluginCall){
        if let saved=IOSCredential.read(){
            call.resolve(["provisioned":true,"deviceId":saved["deviceId"] ?? ""])
        }else{call.resolve(["provisioned":false])}
    }
    @objc func provision(_ call:CAPPluginCall){
        guard let id=call.getString("deviceId"),
              let secret=call.getString("deviceSecret"),
              UUID(uuidString:id) != nil,
              secret.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil,
              IOSCredential.save(id,secret) else {call.reject("ios_device_not_saved");return}
        call.resolve(["saved":true])
    }
    @objc func clear(_ call:CAPPluginCall){
        IOSCredential.clear();call.resolve(["cleared":true])
    }
    @objc func ownerRequest(_ call:CAPPluginCall){
        guard let action=call.getString("action"),["enroll","delete"].contains(action),
              let payload=call.getObject("payload"),
              let access=call.getString("accessToken"),
              access.count>=20 else {call.reject("ios_owner_invalid_request");return}
        Task{
            do{
                let reply=try await IOSNet.request("/bridge/owner/"+action,payload,bearer:access)
                call.resolve(reply)
            }catch{call.reject("ios_owner_network_failed")}
        }
    }
}
@objc(BridgeTxControl)
public class IOSBridgeTx: CAPPlugin,CAPBridgedPlugin {
    public let identifier="BridgeTxControl"
    public let jsName="BridgeTxControl"
    public let pluginMethods:[CAPPluginMethod]=[
        CAPPluginMethod(name:"status",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"start",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"stop",returnType:CAPPluginReturnPromise)
    ]
    private var work:Task<Void,Never>?
    private var active=false
    private var listening=false
    public override func load(){
        if !listening {
            listening=true
            NotificationCenter.default.addObserver(self,selector:#selector(suspendBridge),
                name:UIApplication.didEnterBackgroundNotification,object:nil)
        }
    }
    @objc private func suspendBridge(){
        work?.cancel();work=nil;active=false
    }
    @objc func status(_ call:CAPPluginCall){
        call.resolve(["configured":IOSCredential.read() != nil,
            "running":active,"paused":UserDefaults.standard.bool(forKey:FreePTIOS.paused)])
    }
    @objc func start(_ call:CAPPluginCall){
        guard IOSCredential.read() != nil,IOSFolder.shared.allowed() else {
            call.reject("ios_folder_not_shared");return
        }
        UserDefaults.standard.set(false,forKey:FreePTIOS.paused)
        guard work == nil else{call.resolve(["started":true]);return}
        active=true
        work=Task{[weak self] in await self?.loop() }
        call.resolve(["started":true])
    }
    @objc func stop(_ call:CAPPluginCall){
        UserDefaults.standard.set(true,forKey:FreePTIOS.paused)
        suspendBridge()
        call.resolve(["stopped":true])
    }
    private func loop() async {
        defer {active=false;work=nil}
        guard let saved=IOSCredential.read(),let id=saved["deviceId"],
              let secret=saved["deviceSecret"] else{return}
        while !Task.isCancelled && UIApplication.shared.applicationState == .active {
            var token:String?
            do{
                let connect=try await IOSNet.request("/bridge/tx/connect",
                    ["deviceId":id,"deviceSecret":secret])
                guard let session=connect["token"] as? String else {return}
                token=session
                while !Task.isCancelled && UIApplication.shared.applicationState == .active {
                    let result=try await IOSNet.request("/bridge/tx/poll",
                        ["deviceId":id,"sessionToken":session])
                    if let item=result["job"] as? [String:Any] {
                        try await execute(item,id,session)
                    }else{try await Task.sleep(nanoseconds:2_000_000_000)}
                }
            }catch{
                if !Task.isCancelled {
                    try? await Task.sleep(nanoseconds:3_000_000_000)
                }
            }
            if let token {
                _ = try? await IOSNet.request("/bridge/tx/disconnect",
                    ["deviceId":id,"sessionToken":token])
            }
        }
    }
    private func execute(_ job:[String:Any],_ id:String,_ token:String) async throws {
        guard let requestId=job["jobId"] as? String,UUID(uuidString:requestId) != nil,
              let target=job["deviceId"] as? String,target==id,
              let action=job["operation"] as? String else {
            throw NSError(domain:"ios_wrong_job",code:1)
        }
        var body:[String:Any]=["deviceId":id,"sessionToken":token,"jobId":requestId]
        let route:String
        switch action {
        case "list":
            let page=try IOSFolder.shared.list("root",0)
            guard (page["nextOffset"] as? Int)==(-1) else {
                throw NSError(domain:"ios_root_requires_pagination",code:1)
            }
            body["entries"]=page["entries"];route="/bridge/tx/folder"
        case "browse":
            guard let handle=job["handle"] as? String,
                  let offset=job["offset"] as? Int else {
                throw NSError(domain:"ios_bad_browse",code:1)
            }
            let page=try IOSFolder.shared.list(handle,offset)
            body["entries"]=page["entries"]
            body["nextOffset"]=page["nextOffset"]
            route="/bridge/tx/browse"
        case "read":
            guard let handle=job["handle"] as? String,
                  let offset=job["offset"] as? Int,
                  let length=job["length"] as? Int else {
                throw NSError(domain:"ios_bad_read",code:1)
            }
            body["chunk"]=try IOSFolder.shared.read(handle,offset,length)
            route="/bridge/tx/chunk"
        default:throw NSError(domain:"ios_unknown_job",code:1)
        }
        let done=try await IOSNet.request(route,body)
        guard done["jobId"] as? String==requestId,
              done["deviceId"] as? String==id,
              done["state"] as? String=="done" else {
            throw NSError(domain:"ios_job_not_acknowledged",code:1)
        }
    }
}
class FreePTIOSViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(IOSBridgeFiles())
        bridge?.registerPluginInstance(IOSBridgeFolder())
        bridge?.registerPluginInstance(IOSBridgeCredentials())
        bridge?.registerPluginInstance(IOSBridgeTx())
    }
}
