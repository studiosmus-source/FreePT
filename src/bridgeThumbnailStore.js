/**
 * Persistent, bounded cache of LIST THUMBNAILS only (144 px JPEG) for the
 * administrator app. Never stores originals, previews, handles or file names:
 * the key is a SHA-256 of (admin, device, folder path, name, size, mime).
 *
 * Invalidation: any change of path, name, size or type yields a new key.
 * Entries expire after `ttlMs`. Entries of devices no longer granted to the
 * administrator are deleted (`retainDevices`), and everything is deleted on
 * logout (`clear`). Same size + same name with different content cannot be
 * detected: the remote catalogue does not expose modification dates.
 */
const DB='freept-bridge-thumbnails';
const STORE='thumbs';

export async function bridgeThumbnailKey(parts){
  const text=parts.map(part=>String(part).replaceAll('\u0000','')).join('\u0000');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

const request=req=>new Promise((resolve,reject)=>{
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});

export function createBridgeThumbnailStore({
  indexedDB=globalThis.indexedDB,now=Date.now,
  maxEntries=1500,maxBytes=24*1024*1024,ttlMs=21*24*3600*1000,maxBlobBytes=96*1024
}={}){
  if(!indexedDB||typeof indexedDB.open!=='function'||!globalThis.crypto?.subtle)return null;
  let opening=null;
  const open=()=>opening??=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{
      const store=req.result.createObjectStore(STORE,{keyPath:'key'});
      store.createIndex('at','at');store.createIndex('deviceId','deviceId');
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{opening=null;reject(req.error);};
  });
  const tx=async(mode,run)=>{
    const db=await open();
    const transaction=db.transaction(STORE,mode);
    // Listen before any request runs: completion can fire right after it.
    const done=new Promise((resolve,reject)=>{
      transaction.oncomplete=resolve;
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error);
    });
    const [result]=await Promise.all([run(transaction.objectStore(STORE)),done]);
    return result;
  };
  let writes=0;
  const prune=()=>tx('readwrite',store=>new Promise((resolve,reject)=>{
    // Oldest first: drop expired entries, then enforce count and byte limits.
    const all=[];
    const cursorReq=store.index('at').openCursor();
    cursorReq.onerror=()=>reject(cursorReq.error);
    cursorReq.onsuccess=()=>{
      const cursor=cursorReq.result;
      if(cursor){all.push({key:cursor.value.key,at:cursor.value.at,size:cursor.value.size});cursor.continue();return;}
      let count=all.length,bytes=all.reduce((sum,x)=>sum+x.size,0);
      for(const entry of all){
        if(now()-entry.at<=ttlMs&&count<=maxEntries&&bytes<=maxBytes)break;
        store.delete(entry.key);count--;bytes-=entry.size;
      }
      resolve();
    };
  }));
  return Object.freeze({
    async get(key){
      const row=await tx('readonly',store=>request(store.get(key)));
      if(!row||now()-row.at>ttlMs)return null;
      return row.blob instanceof Blob?row.blob:null;
    },
    async put(key,blob,{deviceId=''}={}){
      if(!(blob instanceof Blob)||blob.size>maxBlobBytes)return;
      await tx('readwrite',store=>request(store.put({key,deviceId,blob,size:blob.size,at:now()})));
      if(++writes%25===1)await prune();
    },
    /** Revocation: keep only thumbnails of devices still granted. */
    async retainDevices(deviceIds){
      const keep=new Set(deviceIds);
      await tx('readwrite',store=>new Promise((resolve,reject)=>{
        const cursorReq=store.openCursor();
        cursorReq.onerror=()=>reject(cursorReq.error);
        cursorReq.onsuccess=()=>{
          const cursor=cursorReq.result;
          if(!cursor){resolve();return;}
          if(!keep.has(cursor.value.deviceId))cursor.delete();
          cursor.continue();
        };
      }));
    },
    async clear(){await tx('readwrite',store=>request(store.clear()));},
    prune
  });
}
