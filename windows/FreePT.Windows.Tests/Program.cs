using FreePT.Windows;
using System.Text;
var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"freept-windows-test-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
try{
 var child=Path.Combine(folder,"Cartella");
 Directory.CreateDirectory(child);
 var bytes=Encoding.UTF8.GetBytes("FreePT Windows test");
 File.WriteAllBytes(Path.Combine(child,"test.txt"),bytes);
 File.WriteAllText(Path.Combine(folder,".nascosto"),"ok");
 var catalog=new BridgeCatalogue(new[]{folder});
 var root=catalog.Browse("root",0);
 if(root.Entries.Length!=1||!root.Entries[0].Directory||root.NextOffset!=-1)throw new Exception("root contract");
 var page=catalog.Browse(root.Entries[0].Handle,0);
 if(page.Entries.Length!=2||!page.Entries[0].Directory||page.Entries[1].Name!=".nascosto")throw new Exception("ordering/hidden");
 var nested=catalog.Browse(page.Entries[0].Handle,0);
 if(nested.Entries.Length!=1||nested.Entries[0].Name!="test.txt")throw new Exception("nested");
 var chunk=catalog.Read(nested.Entries[0].Handle,0,262144);
 if(Convert.ToBase64String(bytes)!=chunk.Base64||chunk.BytesRead!=bytes.Length||!chunk.Eof)throw new Exception("chunk contract");
 try{catalog.Read(nested.Entries[0].Handle,0,262145);throw new Exception("oversized chunk accepted");}
 catch(ArgumentOutOfRangeException){}
 try{catalog.Browse("../",0);throw new Exception("path escape accepted");}
 catch(UnauthorizedAccessException){}
 // An explicit directory junction is prohibited when Windows supports it.
 var outside=Path.Combine(Path.GetTempPath(),"freept-outside-"+Guid.NewGuid().ToString("N"));
 Directory.CreateDirectory(outside);
 var link=Path.Combine(folder,"link");
 try{Directory.CreateSymbolicLink(link,outside);
    var filtered=catalog.Browse(root.Entries[0].Handle,0);
    if(filtered.Entries.Any(x=>x.Name=="link"))throw new Exception("symlink exposed");
 }catch(UnauthorizedAccessException){}finally{if(Directory.Exists(link))Directory.Delete(link);Directory.Delete(outside);}
 Console.WriteLine("FreePT Windows catalogue contracts OK");
}finally{Directory.Delete(folder,true);}
