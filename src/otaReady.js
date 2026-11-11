/**
 * OTA readiness is independent of Supabase, login, chat and Bridge.
 * Never let an updater failure prevent the normal FreePT startup.
 */
export async function reportOtaReady(updater,isNative){
  if(!isNative||typeof updater?.notifyAppReady!=='function')return false;
  try{await updater.notifyAppReady();return true;}
  catch{return false;}
}
