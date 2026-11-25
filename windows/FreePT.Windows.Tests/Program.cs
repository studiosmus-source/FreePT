using FreePT.Windows;
using System.Text;
var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
    "freept-windows-test-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
try{
    var child=Path.Combine(folder,"Cartella");
    Directory.CreateDirectory(child);
    var bytes=Encoding.UTF8.GetBytes("FreePT Windows test");
    File.WriteAllBytes(Path.Combine(child,"test.txt"),bytes);
    File.WriteAllText(Path.Combine(folder,".nascosto"),"ok");
    var catalog=new BridgeCatalogue();
    var root=catalog.Browse("root",0);
    if(root.Entries.Length<1||!root.Entries.All(x=>x.Directory))throw new Exception("auto drive enumeration");
    var disk=Path.GetPathRoot(folder)!;
    var volume=root.Entries.SingleOrDefault(x=>x.Name.Equals(disk.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))
        ??throw new Exception("host volume not exposed");
    var handle=volume.Handle;
    var segments=Path.GetRelativePath(disk,folder).Split(Path.DirectorySeparatorChar,StringSplitOptions.RemoveEmptyEntries);
    foreach(string segment in segments){
        var page=catalog.Browse(handle,0);var offset=page.NextOffset;
        FileEntry? matching=page.Entries.FirstOrDefault(x=>x.Directory&&x.Name.Equals(segment,StringComparison.OrdinalIgnoreCase));
        while(matching==null&&offset>=0){
            page=catalog.Browse(handle,offset);offset=page.NextOffset;
            matching=page.Entries.FirstOrDefault(x=>x.Directory&&x.Name.Equals(segment,StringComparison.OrdinalIgnoreCase));
        }
        if(matching==null)throw new Exception("accessible Windows directory missing "+segment);
        handle=matching.Handle;
    }
    var listed=catalog.Browse(handle,0);
    if(listed.Entries.Length!=2||!listed.Entries[0].Directory||listed.Entries[1].Name!=".nascosto")
        throw new Exception("directory-first/hidden");
    var nested=catalog.Browse(listed.Entries[0].Handle,0);
    if(nested.Entries.Length!=1||nested.Entries[0].Name!="test.txt")throw new Exception("nested");
    var chunk=catalog.Read(nested.Entries[0].Handle,0,262144);
    if(chunk.Base64!=Convert.ToBase64String(bytes)||chunk.BytesRead!=bytes.Length||!chunk.Eof)
        throw new Exception("chunk contract");
    try{catalog.Read(nested.Entries[0].Handle,0,262145);throw new Exception("oversized chunk accepted");}
    catch(ArgumentOutOfRangeException){}
    try{catalog.Browse("../",0);throw new Exception("path escape accepted");}
    catch(UnauthorizedAccessException){}
    var outside=Path.Combine(Path.GetTempPath(),"freept-outside-"+Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(outside);
    var link=Path.Combine(folder,"link");
    try{
        Directory.CreateSymbolicLink(link,outside);
        var filtered=catalog.Browse(handle,0);
        if(filtered.Entries.Any(x=>x.Name=="link"))throw new Exception("symlink exposed");
    }catch(UnauthorizedAccessException){}
    finally{if(Directory.Exists(link))Directory.Delete(link);Directory.Delete(outside);}
    // A junction (directory link) is excluded exactly like a symbolic link.
    var junctionTarget=Path.Combine(Path.GetTempPath(),"freept-jt-"+Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(junctionTarget);
    var junction=Path.Combine(folder,"giunzione");
    try{
        var mk=System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe",
            "/c mklink /J \""+junction+"\" \""+junctionTarget+"\""){CreateNoWindow=true,UseShellExecute=false});
        mk!.WaitForExit();
        if(Directory.Exists(junction)&&catalog.Browse(handle,0).Entries.Any(x=>x.Name=="giunzione"))
            throw new Exception("junction exposed");
    }finally{if(Directory.Exists(junction))Directory.Delete(junction);Directory.Delete(junctionTarget);}
    // A regular file whose attributes carry only cloud-style flags stays visible.
    var offline=Path.Combine(child,"cloud.txt");
    File.WriteAllText(offline,"x");
    File.SetAttributes(offline,FileAttributes.Offline|FileAttributes.Archive);
    if(!catalog.Browse(listed.Entries[0].Handle,0).Entries.Any(x=>x.Name=="cloud.txt"))
        throw new Exception("offline file hidden");
    File.SetAttributes(offline,FileAttributes.Normal);
    Console.WriteLine("FreePT Windows automatic-volume catalogue OK");
}finally{Directory.Delete(folder,true);}
