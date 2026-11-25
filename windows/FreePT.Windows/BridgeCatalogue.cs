using System.Collections.Concurrent;
using System.Net.Mime;
using System.Text;
using System.Text.Json.Serialization;
namespace FreePT.Windows;
// Only enumerate drives Windows exposes as ready to the signed-in user. No privilege escalation.
// Symbolic links and junctions are never followed. Other reparse points (OneDrive and
// cloud "on demand" files, deduplicated files) are ordinary user files and are shown.
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
    // Drives can appear and disappear (USB, mapped network volumes). The list is
    // cached briefly: a disconnected network drive can block IsReady for seconds,
    // and the list used to be rebuilt for every single file of every page.
    private static string[] cachedRoots=Array.Empty<string>();
    private static long cachedRootsAt=0;
    private static bool rootsCached=false;
    private static readonly object rootsGate=new();
    private static string[] Roots(){
        lock(rootsGate){
            long now=Environment.TickCount64;
            if(rootsCached&&now-cachedRootsAt<5000)return cachedRoots;
            cachedRoots=DriveInfo.GetDrives()
                .Where(d=>{try{return d.IsReady&&Directory.Exists(d.RootDirectory.FullName);}catch{return false;}})
                .Select(d=>Path.GetFullPath(d.RootDirectory.FullName))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            cachedRootsAt=now;rootsCached=true;
            return cachedRoots;
        }
    }
    // A link is a symbolic link or junction (LinkTarget set). Cloud placeholders
    // carry a reparse attribute too but are regular files and stay visible.
    static bool IsLink(FileSystemInfo info){
        try{return info.LinkTarget!=null;}catch{return true;}
    }
    static bool IsLink(string path){
        try{
            FileSystemInfo info=Directory.Exists(path)?new DirectoryInfo(path):new FileInfo(path);
            return IsLink(info);
        }catch{return true;}
    }
    static bool IsRoot(string full)=>Roots().Any(root=>string.Equals(
        full.TrimEnd(Path.DirectorySeparatorChar),root.TrimEnd(Path.DirectorySeparatorChar),
        StringComparison.OrdinalIgnoreCase));
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
            // Reject junctions/symlinks anywhere along a selected path (drive roots
            // themselves are mount points, not links to elsewhere).
            var walk=full;
            while(!string.IsNullOrEmpty(walk)){
                if(!IsRoot(walk)&&IsLink(walk))return false;
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
            // The parent was fully validated above: each child only needs its own
            // link/private-folder check (was a full drive scan + walk per child).
            var options=new EnumerationOptions{IgnoreInaccessible=true,AttributesToSkip=0,
                RecurseSubdirectories=false,ReturnSpecialDirectories=false};
            FileSystemInfo[] items;
            try{
                items=info.EnumerateFileSystemInfos("*",options)
                    .Where(item=>ValidName(item.Name)&&!IsLink(item)&&!Protected(item.FullName))
                    .OrderBy(item=>(item.Attributes&FileAttributes.Directory)==0)
                    .ThenBy(item=>item.Name,StringComparer.OrdinalIgnoreCase).ThenBy(item=>item.Name,StringComparer.Ordinal)
                    .Take(MaxEntries+1).ToArray();
            }catch(UnauthorizedAccessException){
                // Windows denies this folder to the signed-in user (e.g. System Volume
                // Information): answer an empty page instead of leaving the remote
                // request waiting until its timeout.
                items=Array.Empty<FileSystemInfo>();
            }
            var nodes=new List<FileEntry>(items.Length);
            foreach(var item in items){
                try{
                    bool dir=(item.Attributes&FileAttributes.Directory)!=0;
                    long size=dir?-1:((FileInfo)item).Length;
                    nodes.Add(new FileEntry(Handle(item.FullName),item.Name,dir,size,
                        dir?"vnd.android.document/directory":"application/octet-stream"));
                }catch(IOException){/* removed while listing */}
                catch(UnauthorizedAccessException){}
            }
            return Slice(nodes.ToArray(),offset);
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
