using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace FreePT.Windows;
public sealed record BridgeConfig(string DeviceId,string DeviceSecret,string[] Roots);
internal static class LocalState {
    internal static string Folder=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FreePT.Windows");
    private static string Filename=>Path.Combine(Folder,"bridge.dat");
    internal static BridgeConfig? Read() {
        try {
            if(!File.Exists(Filename))return null;
            var bytes=ProtectedData.Unprotect(File.ReadAllBytes(Filename),null,DataProtectionScope.CurrentUser);
            var config=JsonSerializer.Deserialize<BridgeConfig>(bytes);
            if(config==null||!Guid.TryParse(config.DeviceId,out _)||
              !System.Text.RegularExpressions.Regex.IsMatch(config.DeviceSecret,"^[a-f0-9]{64}$"))return null;
            return config;
        }catch{return null;}
    }
    internal static void Write(BridgeConfig config){
        Directory.CreateDirectory(Folder);
        byte[] payload=JsonSerializer.SerializeToUtf8Bytes(config);
        File.WriteAllBytes(Filename,ProtectedData.Protect(payload,null,DataProtectionScope.CurrentUser));
    }
    internal static void Clear(){if(File.Exists(Filename))File.Delete(Filename);}
}
