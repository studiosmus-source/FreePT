/**
 * Fail-closed owner filter: the selected chat user must be the authenticated
 * owner of every device shown in the remote browser.
 * Server-side RLS and per-job grant checks remain authoritative.
 */
export function filterOwnerAuthorizedDevices(rows,{ownerId=null}={}){
  if(ownerId!==null&&
     (typeof ownerId!=='string'||!ownerId.trim()))return [];
  if(!Array.isArray(rows))return [];
  const seen=new Set(),result=[];
  for(const row of rows){
    const device=row?.bridge_devices;
    if(!device||typeof device.id!=='string'||!device.id||
       typeof device.owner_id!=='string'||!device.owner_id||
       row?.device_id!==device.id||device.bridge_enabled!==true||
       (ownerId!==null&&device.owner_id!==ownerId)||
       seen.has(device.id))continue;
    seen.add(device.id);
    result.push({id:device.id,label:typeof device.label==='string'?device.label:'Telefono',owner_id:device.owner_id});
  }
  return result;
}
