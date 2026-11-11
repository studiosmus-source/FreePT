/**
 * Read-only self-hosted Capgo auto-update response. TEST devices are selected
 * by a SERVER-SIDE allowlist, never by client-supplied channel/custom_id.
 * A release is compatible only with its exact native Android versionCode.
 */
const SEMVER=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CHECKSUM=/^[a-f0-9]{64}$/i;
const BUNDLE_URL=/^https:\/\/github\.com\/studiosmus-source\/FreePT\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.zip$/;

export function parseVersion(value){
  if(typeof value!=='string'||!SEMVER.test(value))return null;
  const result=value.split('.').map(Number);
  return result.every(n=>Number.isSafeInteger(n))?result:null;
}
export function isNewer(candidate,current){
  const next=parseVersion(candidate);
  if(!next)return false;
  if(current==='builtin')return true;
  const previous=parseVersion(current);
  if(!previous)return false;
  for(let i=0;i<3;i++)if(next[i]!==previous[i])return next[i]>previous[i];
  return false;
}
export function validateRelease(input){
  if(!input||input.enabled!==true)return null;
  const keys=Object.keys(input).sort().join(',');
  if(keys!=='checksum,enabled,nativeVersionCode,url,version'||
     !parseVersion(input.version)||!BUNDLE_URL.test(input.url)||
     !CHECKSUM.test(input.checksum)||
     !(Number.isSafeInteger(input.nativeVersionCode)&&input.nativeVersionCode>0))
    throw Error('ota_release_manifest_invalid');
  return Object.freeze({
    version:input.version,url:input.url,checksum:input.checksum.toLowerCase(),
    nativeVersionCode:String(input.nativeVersionCode)
  });
}
export function noUpdateResponse(){
  return {error:'no_new_version_available',message:'No new version available'};
}
export function chooseUpdate(info,{stable=null,test=null,testDeviceIds=new Set()}={}){
  if(!info||info.platform!=='android'||info.app_id!=='it.freept.app'||
     typeof info.version_name!=='string'||typeof info.device_id!=='string'||
     info.device_id.length<6||info.device_id.length>200)return noUpdateResponse();
  const release=(testDeviceIds.has(info.device_id)&&test)||stable;
  if(!release||String(info.version_code)!==release.nativeVersionCode||
     !isNewer(release.version,info.version_name))return noUpdateResponse();
  return {version:release.version,url:release.url,checksum:release.checksum};
}
export function parseTestDeviceIds(raw=''){
  if(typeof raw!=='string')throw Error('ota_device_allowlist_invalid');
  const ids=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(ids.length>30||ids.some(id=>!/^[A-Za-z0-9_-]{6,200}$/.test(id)))
    throw Error('ota_device_allowlist_invalid');
  return new Set(ids);
}
