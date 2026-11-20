"""Execute actual catalogue Java on a JVM with narrow Android API stubs."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class CatalogueTests(unittest.TestCase):
    def test_hidden_files_bytes_and_protected_boundaries(self):
        root = Path(__file__).resolve().parent
        sources = {
            'android/os/Build.java': 'package android.os; public class Build { public static class VERSION { public static int SDK_INT=30; }}',
            'android/os/Environment.java': '''package android.os; import java.io.File;
public class Environment {public static final String MEDIA_MOUNTED="mounted";public static boolean isExternalStorageManager(){return true;}
public static File getExternalStorageDirectory(){return new File(System.getProperty("catalogue.root"));}}''',
            'android/content/Context.java': '''package android.content;
public class Context {
 public static final String STORAGE_SERVICE="storage";
 public Context getApplicationContext(){return this;}
 public Object getSystemService(String key){return new android.os.storage.StorageManager();}
}''',
            'android/os/storage/StorageManager.java': '''package android.os.storage;
import java.util.List;
public class StorageManager {
 public List<StorageVolume> getStorageVolumes(){return List.of(new StorageVolume());}
}''',
            'android/os/storage/StorageVolume.java': '''package android.os.storage;
import java.io.File;
public class StorageVolume {
 public boolean isPrimary(){return false;}
 public String getState(){return "mounted";}
 public File getDirectory(){return new File(System.getProperty("catalogue.volume"));}
}''',
            'android/util/Log.java': 'package android.util; public class Log {public static int i(String a,String b){return 0;}}',
            'android/util/Base64.java': '''package android.util; public class Base64 {
public static final int NO_WRAP=2;public static String encodeToString(byte[] b,int f){return java.util.Base64.getEncoder().encodeToString(b);}}''',
            'com/getcapacitor/JSObject.java': 'package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}',
            'com/getcapacitor/JSArray.java': 'package com.getcapacitor; public class JSArray extends java.util.ArrayList<Object> {public void put(Object x){add(x);}}',
            'catalogue/BridgeAllFilesCore.java': (root / 'BridgeAllFilesCore.java.template').read_text().replace('__PACKAGE__', 'catalogue'),
            'catalogue/Harness.java': '''package catalogue;
import java.nio.file.*;import com.getcapacitor.*;
public class Harness {
 public static void main(String[] args)throws Exception {
  Path root=Path.of(System.getProperty("catalogue.root"));
  Path extra=Path.of(System.getProperty("catalogue.volume"));
  Files.createDirectories(extra);
  Files.write(extra.resolve("extra.bin"),new byte[]{5,6});
  Files.createDirectories(extra.resolve("Android/data"));
  BridgeAllFilesCore.configure(new android.content.Context());
  Files.write(root.resolve(".hidden"),new byte[]{1,2,3,4});
  Files.write(root.resolve(".nomedia"),new byte[0]);
  Files.createDirectories(root.resolve(".private-folder"));
  Files.write(root.resolve(".private-folder/.secret"),new byte[]{7,8});
  Files.createDirectories(root.resolve("Android/data"));
  Files.createDirectories(root.resolve("Android/obb"));
  Files.createDirectories(root.resolve("Android/media"));
  // This directory sorts after 'file-*' by name, but MUST appear before files.
  Files.createDirectories(root.resolve("zz-last-folder"));
  Files.createSymbolicLink(root.resolve("escape"),root.getParent());
  for(int i=0;i<145;i++)Files.write(root.resolve(String.format("file-%03d.txt",i)),new byte[]{1});
  JSArray page=(JSArray)BridgeAllFilesCore.list("root",0).get("entries");
  if(page.size()!=100)throw new AssertionError("first page should contain 100 entries");
  int next=(Integer)BridgeAllFilesCore.list("root",0).get("nextOffset");
  if(next!=100)throw new AssertionError("pagination did not advance by 100");
  // A new child appearing between pages must not shift or duplicate
  // already paginated items. A fresh page-0 request rebuilds the snapshot.
  Files.write(root.resolve("new-after-first-page.txt"),new byte[]{1});
  JSObject follow=BridgeAllFilesCore.list("root",next);
  JSArray second=(JSArray)follow.get("entries");
  if((Integer)follow.get("nextOffset")!=-1||second.size()!=51)
   throw new AssertionError("last page missing entries");
  java.util.HashSet<String> unique=new java.util.HashSet<>();
  for(Object entry:page)unique.add((String)((JSObject)entry).get("handle"));
  for(Object entry:second)unique.add((String)((JSObject)entry).get("handle"));
  if(unique.size()!=151)throw new AssertionError("duplicate or missing catalogue handles");
  // Native, global ordering (not per page): folders always precede files.
  // Mounted volumes are pinned first; shared folders and files follow
  // alphabetically, case-insensitively with a deterministic tie break.
  java.util.List<JSObject> ordered=new java.util.ArrayList<>();
  for(Object e:page)ordered.add((JSObject)e);
  for(Object e:second)ordered.add((JSObject)e);
  boolean seenFile=false,seenTrailingFolder=false;
  String previousFolder=null,previousFile=null;
  for(JSObject entry:ordered){
   String name=(String)entry.get("name");
   boolean folder=(Boolean)entry.get("directory");
   if(folder){
    if(seenFile)throw new AssertionError("folder appeared after a file");
    if("zz-last-folder".equals(name))seenTrailingFolder=true;
    if(!name.startsWith("Memoria aggiuntiva")){
     if(previousFolder!=null && name.compareToIgnoreCase(previousFolder)<0)
      throw new AssertionError("directories not alphabetical");
     previousFolder=name;
    }
   }else{
    seenFile=true;
    if(previousFile!=null && name.compareToIgnoreCase(previousFile)<0)
      throw new AssertionError("files not alphabetical across pages");
    previousFile=name;
   }
  }
  if(!seenTrailingFolder||!seenFile)
   throw new AssertionError("ordering fixture missing folder or file");
  // Explicit refresh reconstructs a new view, including additions that
  // were intentionally not allowed to destabilize the first pagination.
  BridgeAllFilesCore.list("root",0);
  JSArray refreshed=(JSArray)BridgeAllFilesCore.list("root",100).get("entries");
  if(refreshed.size()!=52)throw new AssertionError("refresh did not discover new file");
  String hidden=null,android=null,extraHandle=null,privateFolder=null,nomedia=null;
  for(Object x:page){JSObject e=(JSObject)x;String n=(String)e.get("name");
   if(n.equals("escape"))throw new AssertionError("symlink escaped");
   if(n.equals(".hidden"))hidden=(String)e.get("handle");
   if(n.equals(".private-folder"))privateFolder=(String)e.get("handle");
   if(n.equals(".nomedia"))nomedia=(String)e.get("handle");
   if(n.equals("Android"))android=(String)e.get("handle");
   if(n.equals("Memoria aggiuntiva 1"))extraHandle=(String)e.get("handle");
  }
  if(hidden==null||privateFolder==null||nomedia==null||android==null||extraHandle==null)
   throw new AssertionError("missing dot-hidden shared items or secondary volume");
  JSArray nested=(JSArray)BridgeAllFilesCore.list(privateFolder,0).get("entries");
  if(nested.size()!=1||!".secret".equals(((JSObject)nested.get(0)).get("name")))
   throw new AssertionError("hidden nested file missing");
  String secret=(String)((JSObject)nested.get(0)).get("handle");
  if(!"Bwg=".equals(BridgeAllFilesCore.read(secret,0,2).get("base64")))
   throw new AssertionError("nested hidden file read mismatch");
  JSArray extraPage=(JSArray)BridgeAllFilesCore.list(extraHandle,0).get("entries");
  String extraFile=null,extraAndroid=null;
  for(Object x:extraPage){
   JSObject e=(JSObject)x;
   if("extra.bin".equals(e.get("name")))extraFile=(String)e.get("handle");
   if("Android".equals(e.get("name")))extraAndroid=(String)e.get("handle");
  }
  if(extraFile==null||extraAndroid==null)
   throw new AssertionError("secondary shared-storage missing");
  // The only child is protected: the catalogue must fail explicitly rather
  // than silently report the protected directory as an empty readable one.
  try{
   BridgeAllFilesCore.list(extraAndroid,0);
   throw new AssertionError("private secondary Android/data was not rejected");
  }catch(java.io.IOException blocked){
   if(!"directory_entries_inaccessible".equals(blocked.getMessage()))throw blocked;
  }
  if(!"BQY=".equals(BridgeAllFilesCore.read(extraFile,0,2).get("base64")))
   throw new AssertionError("secondary volume bytes missing");
  if(!"AQIDBA==".equals(BridgeAllFilesCore.read(hidden,0,4).get("base64")))throw new AssertionError("wrong bytes");
  JSArray protectedPage=(JSArray)BridgeAllFilesCore.list(android,0).get("entries");
  if(protectedPage.size()!=1||!"media".equals(((JSObject)protectedPage.get(0)).get("name")))throw new AssertionError("protected data exposed");
 }
}'''
        }
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            files = []
            for name, text in sources.items():
                p = base / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text)
                files.append(str(p))
            storage = base / 'storage'
            storage.mkdir()
            external = base / 'removable'
            external.mkdir()
            subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', tmp, *files], check=True, capture_output=True)
            run = subprocess.run(['java', '-Dcatalogue.root=' + str(storage),
                                  '-Dcatalogue.volume=' + str(external), '-cp', tmp,
                                  'catalogue.Harness'], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
