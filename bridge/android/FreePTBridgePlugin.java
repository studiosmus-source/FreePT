package it.freept.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;
import android.database.Cursor;

@CapacitorPlugin(name = "FreePTBridge")
public class FreePTBridgePlugin extends Plugin {
    private static final String PREF = "freept_bridge_v2";
    private static final String TREE = "tree_uri";
    private static final int MAX_CHILDREN = 1000;
    private static final int MAX_SCAN = 30000;
    private static final int CHUNK_BYTES = 48 * 1024;

    private Uri tree() {
        String value = getContext().getSharedPreferences(PREF, 0).getString(TREE, null);
        if (value == null) return null;
        Uri uri = Uri.parse(value);
        boolean granted = false;
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.isReadPermission() && permission.getUri().equals(uri)) { granted = true; break; }
        }
        return granted ? uri : null;
    }
    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("authorized", tree() != null);
        call.resolve(out);
    }
    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderSelected");
    }
    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Autorizzazione annullata"); return;
        }
        Uri selected = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(selected, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().getSharedPreferences(PREF, 0).edit().putString(TREE, selected.toString()).apply();
            JSObject out = new JSObject();
            out.put("authorized", true);
            call.resolve(out);
        } catch (Exception e) { call.reject("Impossibile conservare il permesso della cartella", e); }
    }
    @PluginMethod
    public void revoke(PluginCall call) {
        Uri t = tree();
        if (t != null) {
            try { getContext().getContentResolver().releasePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception ignored) {}
        }
        getContext().getSharedPreferences(PREF, 0).edit().remove(TREE).apply();
        call.resolve();
    }
    private String rootId(Uri t) { return DocumentsContract.getTreeDocumentId(t); }
    private Uri docUri(Uri t, String id) { return DocumentsContract.buildDocumentUriUsingTree(t, id); }
    private Uri childrenUri(Uri t, String id) { return DocumentsContract.buildChildDocumentsUriUsingTree(t, id); }

    // Never trust a document ID from Supabase: it must be discovered by walking
    // descendants of the user's explicitly authorized Storage Access Framework tree.
    private boolean reachable(Uri t, String id) {
        if (id.equals(rootId(t))) return true;
        ArrayDeque<String> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        queue.add(rootId(t));
        int examined = 0;
        while (!queue.isEmpty() && examined < MAX_SCAN) {
            String parent = queue.removeFirst();
            if (!visited.add(parent)) continue;
            try (Cursor c = getContext().getContentResolver().query(childrenUri(t, parent),
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE},
                null, null, null)) {
                if (c == null) continue;
                while (c.moveToNext() && examined++ < MAX_SCAN) {
                    String child = c.getString(0);
                    if (id.equals(child)) return true;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(1))) queue.addLast(child);
                }
            } catch (Exception e) { return false; }
        }
        return false;
    }
    private String requested(PluginCall call, Uri t) {
        String id = call.getString("resourceId");
        return (id == null || id.isEmpty()) ? rootId(t) : id;
    }
    @PluginMethod
    public void list(PluginCall call) {
        Uri t = tree();
        if (t == null) { call.reject("Permesso cartelle non disponibile"); return; }
        String parent = requested(call, t);
        if (!reachable(t, parent)) { call.reject("Cartella fuori dall'autorizzazione"); return; }
        JSArray entries = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(childrenUri(t,parent),
            new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
            if (c == null) throw new IllegalStateException("Impossibile leggere la cartella");
            while (c.moveToNext()) {
                if (entries.length() >= MAX_CHILDREN) throw new IllegalStateException("Cartella con troppi elementi (limite 1000)");
                JSObject e = new JSObject();
                e.put("id", c.getString(0));
                e.put("name", c.getString(1));
                e.put("mime", c.getString(2));
                e.put("directory", DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));
                e.put("size", c.isNull(3) ? null : c.getLong(3));
                entries.put(e);
            }
            JSObject out = new JSObject();
            out.put("parentId",parent);
            out.put("entries",entries);
            call.resolve(out);
        } catch (Exception e) { call.reject("Impossibile elencare i file",e); }
    }
    @PluginMethod
    public void readChunk(PluginCall call) {
        Uri t = tree();
        if (t == null) { call.reject("Permesso cartelle non disponibile"); return; }
        String id = call.getString("resourceId");
        Long off = call.getLong("offset");
        if (id == null || off == null || off < 0 || off > 1073741824L) { call.reject("Richiesta non valida"); return; }
        if (!reachable(t,id)) { call.reject("File fuori dall'autorizzazione"); return; }
        try {
            Uri file = docUri(t,id);
            String mime = getContext().getContentResolver().getType(file);
            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { call.reject("Non è un file"); return; }
            byte[] bytes = new byte[CHUNK_BYTES];
            int total=0;
            try (InputStream in = getContext().getContentResolver().openInputStream(file)) {
                if (in == null) throw new IllegalStateException("File non leggibile");
                long remaining=off;
                while (remaining>0) {
                    long n=in.skip(remaining);
                    if (n<=0) {
                        if (in.read()==-1) break;
                        n=1;
                    }
                    remaining-=n;
                }
                if (remaining>0) { call.reject("Offset oltre la fine del file"); return; }
                while(total<CHUNK_BYTES) {
                    int n=in.read(bytes,total,CHUNK_BYTES-total);
                    if(n<0) break;
                    if(n==0) continue;
                    total+=n;
                }
            }
            byte[] result=new byte[total];
            System.arraycopy(bytes,0,result,0,total);
            JSObject out = new JSObject();
            out.put("base64",Base64.encodeToString(result,Base64.NO_WRAP));
            out.put("length",total);
            out.put("eof",total<CHUNK_BYTES);
            call.resolve(out);
        } catch (Exception e) { call.reject("Lettura file non riuscita",e); }
    }
}
