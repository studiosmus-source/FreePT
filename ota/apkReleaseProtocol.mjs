/**
 * Read-only APK self-update protocol (full-APK channel, distinct from the
 * Capgo web-bundle channel in releaseProtocol.mjs).
 *
 * The server only returns immutable metadata about a GitHub Release .apk:
 * target versionCode, download URL and SHA-256. It never hosts the file, holds
 * secrets, or writes anything. TEST devices are selected by a SERVER-SIDE
 * allowlist, never by a client-supplied field.
 *
 * On-device the updater MUST, before launching Android's package installer:
 *  - download only this exact https GitHub Release URL,
 *  - verify the SHA-256 matches,
 *  - verify the downloaded APK's signing certificate equals the running app's
 *    (Android also enforces same-signature for in-place update, but we fail
 *     early and clearly),
 *  - never offer a lower or equal versionCode (no downgrade),
 *  - never install on an Android older than minSdkInt.
 */
const SEMVER=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SHA256=/^[a-f0-9]{64}$/i;
const APP_ID='it.freept.app';
// Exactly one immutable GitHub Release .apk asset of this repository.
const APK_URL=/^https:\/\/github\.com\/studiosmus-source\/FreePT\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.apk$/;

function isPositiveInt(value){
  return Number.isSafeInteger(value)&&value>0;
}
function toVersionCode(value){
  // Accept integer or canonical decimal string; reject anything else.
  if(isPositiveInt(value))return value;
  if(typeof value==='string'&&/^[1-9][0-9]{0,9}$/.test(value))return Number(value);
  return null;
}

export function validateApkRelease(input){
  if(!input||input.enabled!==true)return null;
  const keys=Object.keys(input).sort().join(',');
  if(keys!=='enabled,minSdkInt,sha256,url,versionCode,versionName'||
     typeof input.versionName!=='string'||!SEMVER.test(input.versionName)||
     !isPositiveInt(input.versionCode)||
     !APK_URL.test(input.url)||
     typeof input.sha256!=='string'||!SHA256.test(input.sha256)||
     !isPositiveInt(input.minSdkInt))
    throw Error('ota_apk_manifest_invalid');
  return Object.freeze({
    versionName:input.versionName,
    versionCode:input.versionCode,
    url:input.url,
    sha256:input.sha256.toLowerCase(),
    minSdkInt:input.minSdkInt
  });
}

export function noApkUpdateResponse(){
  return {error:'no_new_version_available',message:'No new version available'};
}

/**
 * Decide the single APK update to offer this device, or a no-update response.
 * info = { platform, app_id, device_id, version_code, version_name?, sdk_int }
 */
export function chooseApkUpdate(info,{stable=null,test=null,testDeviceIds=new Set()}={}){
  if(!info||info.platform!=='android'||info.app_id!==APP_ID||
     typeof info.device_id!=='string'||info.device_id.length<6||info.device_id.length>200)
    return noApkUpdateResponse();
  const current=toVersionCode(info.version_code);
  const sdk=toVersionCode(info.sdk_int);
  if(current===null||sdk===null)return noApkUpdateResponse();
  const release=(testDeviceIds.has(info.device_id)&&test)||stable;
  if(!release||release.versionCode<=current||sdk<release.minSdkInt)
    return noApkUpdateResponse();
  return {
    versionName:release.versionName,
    versionCode:release.versionCode,
    url:release.url,
    sha256:release.sha256,
    minSdkInt:release.minSdkInt
  };
}

export {APP_ID as FREEPT_APP_ID};
