using System.Collections.Concurrent;
using System.Net.Mime;
using System.Text;
using System.Text.Json.Serialization;
namespace FreePT.Windows;
// Only enumerate drives Windows exposes as ready to the signed-in user. No privilege escalation. Reparse points are never followed.
public sealed record FileEntry(
 [property:JsonPropertyName("handle")]string Handle,
 [property:JsonPropertyName("name")]string Name,
 [property:JsonPropertyName("directory")]bool Directory,
 [property:JsonPropertyName("size")]long Size,
 [property:JsonPropertyName("mime")]string Mime);
public sealed record FilePage(
 [property:JsonPropertyName("entries")]FileEntry[] Entries,
 [property:JsonPropertyName("nextOffset")]int NextOffset);
public sealed record FileChunk(
 [property:JsonPropertyName("base64")]string Base64,
 [property:JsonPropertyName("bytesRead")]int BytesRead,
 [property:JsonPropertyName("eof")]bool Eof);
public sealed class BridgeCatalogue {
    private readonly Dictionary<string,string> handles=new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string,string> reverse=new(StringComparer.OrdinalIgnoreCase);
    private readonly object gate=new();
    private const int PageSize=100, MaxEntries=10000, MaxHandles=60000;
    public BridgeCatalogue(){}
    // Drives can appear and disappear (USB, mapped network volumes).
    private static string[] Roots()=>DriveInfo.GetDrives()
        .Where(d=>{try{return d.IsReady&&Directory.Exists(d.RootDirectory.FullName)&&!IsLink(d.RootDirectory.FullName);}catch{return false;}})
        .Select(d=>Path.GetFullPath(d.RootDirectory.FullName))
        .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    static bool IsLink(string path){
        try{return (File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0;}
        catch{return true;}
    }
    private static readonly string PrivateState=Path.GetFullPath(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FreePT.Windows"));
    static bool Protected(string full)=>full.Equals(PrivateState,StringComparison.OrdinalIgnoreCase)||
       full.StartsWith(PrivateState.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,
           StringComparison.OrdinalIgnoreCase);
    bool Allowed(string path){
        try{
            string full=Path.GetFullPath(path);
            if(Protected(full))return false;
            if(!Roots().Any(root=>full.StartsWith(root,StringComparison.OrdinalIgnoreCase)))return false;
            // Reject junctions/symlinks anywhere along a selected path.
            var walk=full;
            while(!string.IsNullOrEmpty(walk)){
                if(IsLink(walk))return false;
                var parent=Path.GetDirectoryName(walk);
                if(parent==null||parent==walk)break;
                walk=parent;
            }
            return true;
        }catch{return false;}
    }
    string Handle(string path){
        if(reverse.TryGetValue(path,out var handle))return handle;
        if(handles.Count>=MaxHandles)throw new IOException("Too many handles");
        handle=Guid.NewGuid().ToString();reverse[path]=handle;handles[handle]=path;return handle;
    }
    public FilePage Browse(string handle,int offset){
        if(offset<0||offset>MaxEntries)throw new ArgumentOutOfRangeException(nameof(offset));
        lock(gate){
            if(handle=="root"){
                var rootNodes=Roots().Select(root=>new FileEntry(Handle(root),
                    root.TrimEnd(Path.DirectorySeparatorChar),true,-1,"vnd.android.document/directory")).ToArray();
                return Slice(rootNodes,offset);
            }
            if(!handles.TryGetValue(handle,out var parent)||!Allowed(parent)||!Directory.Exists(parent))
                throw new UnauthorizedAccessException("Folder unavailable");
            var info=new DirectoryInfo(parent);
            var items=info.EnumerateFileSystemInfos().Where(item=>Allowed(item.FullName)&&ValidName(item.Name))
                .OrderBy(item=>(item.Attributes&FileAttributes.Directory)==0)
                .ThenBy(item=>item.Name,StringComparer.OrdinalIgnoreCase).ThenBy(item=>item.Name,StringComparer.Ordinal)
                .Take(MaxEntries+1).ToArray();
            var nodes=items.Select(item=>{
                bool dir=(item.Attributes&FileAttributes.Directory)!=0;
                long size=dir?-1:((FileInfo)item).Length;
                return new FileEntry(Handle(item.FullName),item.Name,dir,size,
                    dir?"vnd.android.document/directory":"application/octet-stream");
            }).ToArray();
            return Slice(nodes,offset);
        }
    }
    static bool ValidName(string s)=>s.Length is >0 and <=255&&s!="."&&s!=".."&&
      !s.Any(c=>c<' '||c==127||c=='/'||c=='\\');
    static FilePage Slice(FileEntry[] nodes,int offset){
        var slice=nodes.Skip(offset).Take(PageSize).ToArray();
        int next=offset+slice.Length<nodes.Length?offset+slice.Length:-1;
        return new FilePage(slice,next);
    }
    public FileChunk Read(string handle,long offset,int length){
        if(offset<0||length<1||length>262144)throw new ArgumentOutOfRangeException();
        string path;
        lock(gate){
            if(!handles.TryGetValue(handle,out path!)||!Allowed(path)||!File.Exists(path))
                throw new UnauthorizedAccessException("File unavailable");
        }
        using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite);
        if(offset>stream.Length)throw new ArgumentOutOfRangeException(nameof(offset));
        stream.Seek(offset,SeekOrigin.Begin);
        var buffer=new byte[length];int count=0;
        while(count<length){int n=stream.Read(buffer,count,length-count);if(n==0)break;count+=n;}
        return new FileChunk(Convert.ToBase64String(buffer,0,count),count,offset+count>=stream.Length);
    }
}
