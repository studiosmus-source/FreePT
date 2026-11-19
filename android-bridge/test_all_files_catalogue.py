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
public class Environment {public static boolean isExternalStorageManager(){return true;}
public static File getExternalStorageDirectory(){return new File(System.getProperty("catalogue.root"));}}''',
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
  Files.write(root.resolve(".hidden"),new byte[]{1,2,3,4});
  Files.createDirectories(root.resolve(".private-folder"));
  Files.createDirectories(root.resolve("Android/data"));
  Files.createDirectories(root.resolve("Android/obb"));
  Files.createDirectories(root.resolve("Android/media"));
  Files.createSymbolicLink(root.resolve("escape"),root.getParent());
  JSArray page=(JSArray)BridgeAllFilesCore.list("root",0).get("entries");
  String hidden=null,android=null;boolean folder=false;
  for(Object x:page){JSObject e=(JSObject)x;String n=(String)e.get("name");
   if(n.equals("escape"))throw new AssertionError("symlink escaped");
   if(n.equals(".hidden"))hidden=(String)e.get("handle");
   if(n.equals(".private-folder"))folder=true;
   if(n.equals("Android"))android=(String)e.get("handle");
  }
  if(hidden==null||!folder||android==null)throw new AssertionError("missing shared files");
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
            subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', tmp, *files], check=True, capture_output=True)
            subprocess.run(['java', '-Dcatalogue.root=' + str(storage), '-cp', tmp, 'catalogue.Harness'], check=True, capture_output=True)
