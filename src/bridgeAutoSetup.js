/** Continue the existing first-run file-sharing consent after chat approval.
 * No permission prompts, pairing codes, credential replacement or re-grants
 * for an already bound device. Every server call verifies the current owner.
 */
export function createBridgeAutoSetup({native,files,tx,owner,controls,getUser}={}){
 let pending=null;
 async function run(){
  const user=getUser();
  if(!user||user.role!=='user'||user.status!=='approved')return;
  const current=()=>{const u=getUser();return u?.id===user.id&&u.role==='user'&&u.status==='approved';};
  const local=await native.localStatus();
  if(!local?.initialized||local.bound||!current())return;
  const permission=await files.status();
  if(!permission?.granted||!current())return;
  const state=await tx.status();
  if(state?.paused||!current())return;
  const device=await owner.enroll('Dispositivo FreePT');
  if(!current())return;
  await controls.activateFamily(device.deviceId);
  if(!current())return;
  await native.finishOwnerEnrollment();
  if(!current())return;
  // Restart switches the worker from the synthetic pre-account lane to TX.
  await tx.start();
  return {deviceId:device.deviceId};
 }
 return Object.freeze({run(){
  if(!pending)pending=run().finally(()=>{pending=null;});
  return pending;
 }});
}
