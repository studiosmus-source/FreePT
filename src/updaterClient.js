/**
 * Thin, testable wrapper over the native FreePTUpdater plugin.
 * Holds no endpoint and no secret: the native side owns the locked endpoint,
 * the download, and every security check. This layer only orchestrates the
 * user-facing flow and re-validates the shape of what the plugin returns.
 */
const APK_URL=/^https:\/\/github\.com\/studiosmus-source\/FreePT\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.apk$/;
const SHA256=/^[a-f0-9]{64}$/;
const SEMVER=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function createUpdaterClient({plugin}={}){
  if(!plugin||['check','download','install'].some(k=>typeof plugin[k]!=='function'))
    throw Error('updater_client_invalid_options');
  return Object.freeze({
    /** Returns a validated update descriptor, or null when nothing to do. */
    async check(){
      let result;
      try{result=await plugin.check();}catch{return null;}
      if(!result||result.available!==true)return null;
      const {versionName,versionCode,url,sha256}=result;
      if(typeof url!=='string'||!APK_URL.test(url)||
         typeof sha256!=='string'||!SHA256.test(sha256)||
         !Number.isSafeInteger(versionCode)||versionCode<=0||
         typeof versionName!=='string'||!SEMVER.test(versionName))
        return null;
      return Object.freeze({versionName,versionCode,url,sha256});
    },
    /** Downloads (with progress) then launches the Android installer.
     *  Resolves with the native outcome; the OS shows its own confirmation. */
    async downloadAndInstall(update,{onProgress}={}){
      if(!update||!APK_URL.test(update.url)||!SHA256.test(update.sha256)||
         !Number.isSafeInteger(update.versionCode))
        throw Error('updater_invalid_update');
      let remove;
      if(typeof onProgress==='function'&&typeof plugin.addListener==='function'){
        const handle=await plugin.addListener('downloadProgress',event=>{
          const pct=event&&Number(event.percent);
          if(Number.isFinite(pct))onProgress(Math.max(0,Math.min(100,pct)));
        });
        remove=()=>{try{handle&&handle.remove&&handle.remove();}catch{}};
      }
      try{
        const ready=await plugin.download({
          url:update.url,sha256:update.sha256,versionCode:update.versionCode
        });
        if(!ready||ready.ready!==true||typeof ready.path!=='string'||!ready.path)
          throw Error('updater_download_not_ready');
        return await plugin.install({path:ready.path});
      }finally{remove&&remove();}
    }
  });
}
