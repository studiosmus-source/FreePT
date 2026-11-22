import {createBridgeFolderTransmitter} from '../src/bridgeTxFolderClient.js';

const IDLE_DELAYS_MS=Object.freeze([2000,4000,8000,15000,30000]);
const ERROR_DELAYS_MS=Object.freeze([5000,10000,20000,40000,60000]);
const SESSION_MS=4*60*1000;

function safeErrorCode(error){
  const code=error?.message;
  if(code==='bridge_tx_denied')return 'denied';
  if(code==='bridge_tx_network_unavailable')return 'network';
  if(code==='bridge_tx_backend_unavailable')return 'backend';
  if(code==='bridge_tx_rate_limited')return 'rate-limited';
  return 'retrying';
}

export function createBridgeDesktopWorker({
  baseUrl,deviceId,getDeviceSecret,folderProvider,fetchImpl=fetch,
  sleep=(ms,signal)=>new Promise(resolve=>{
    if(signal?.aborted)return resolve();
    const timer=setTimeout(done,ms);
    function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
    signal?.addEventListener('abort',done,{once:true});
  }),
  now=()=>Date.now(),onState=()=>{},
  transmitterFactory=createBridgeFolderTransmitter,
  sessionMs=SESSION_MS
}={}){
  if(typeof getDeviceSecret!=='function'||typeof sleep!=='function'||
     typeof now!=='function'||typeof onState!=='function'||
     typeof transmitterFactory!=='function'||!Number.isSafeInteger(sessionMs)||
     sessionMs<1000)throw Error('bridge_desktop_worker_invalid');
  let controller=null,loopPromise=null;
  let current={running:false,connected:false,lastError:null,lastWorkAt:null};
  const publish=patch=>{
    current={...current,...patch};
    try{onState(Object.freeze({...current}));}catch{}
  };

  async function run(signal){
    let errorIndex=0;
    while(!signal.aborted){
      let secret;
      try{secret=await getDeviceSecret();}
      catch{publish({lastError:'credential-unavailable'});return;}
      if(typeof secret!=='string'||!/^[0-9a-f]{64}$/.test(secret)){
        publish({lastError:'credential-unavailable'});return;
      }
      const tx=transmitterFactory({
        baseUrl,deviceId,deviceSecret:secret,folderProvider,fetchImpl,signal
      });
      try{
        await tx.connect();
        publish({connected:true,lastError:null});
        errorIndex=0;
        const sessionStarted=now();
        let idleIndex=0;
        while(!signal.aborted&&now()-sessionStarted<sessionMs){
          try{
            const worked=await tx.processOne();
            if(worked){
              idleIndex=0;
              publish({lastWorkAt:now(),lastError:null});
            }else{
              const delay=IDLE_DELAYS_MS[Math.min(idleIndex,IDLE_DELAYS_MS.length-1)];
              idleIndex++;
              await sleep(delay,signal);
            }
          }catch(error){
            if(signal.aborted)break;
            if(error?.message==='bridge_tx_denied'){
              publish({lastError:'denied'});
              return;
            }
            const delay=ERROR_DELAYS_MS[Math.min(errorIndex,ERROR_DELAYS_MS.length-1)];
            errorIndex++;
            publish({lastError:safeErrorCode(error)});
            await sleep(delay,signal);
          }
        }
      }catch(error){
        if(signal.aborted)break;
        if(error?.message==='bridge_tx_denied'){
          publish({connected:false,lastError:'denied'});
          return;
        }
        const delay=ERROR_DELAYS_MS[Math.min(errorIndex,ERROR_DELAYS_MS.length-1)];
        errorIndex++;
        publish({connected:false,lastError:safeErrorCode(error)});
        await sleep(delay,signal);
      }finally{
        try{await tx.disconnect();}catch{}
        publish({connected:false});
      }
    }
  }

  return Object.freeze({
    start(){
      if(loopPromise)return {started:true,alreadyRunning:true};
      controller=new AbortController();
      const localController=controller;
      publish({running:true,lastError:null});
      loopPromise=run(localController.signal).catch(()=>{
        publish({lastError:'retrying'});
      }).finally(()=>{
        if(controller===localController){
          controller=null;loopPromise=null;
          publish({running:false,connected:false});
        }
      });
      return {started:true};
    },
    async stop(){
      if(!loopPromise)return {stopped:true,alreadyStopped:true};
      const active=loopPromise;
      controller?.abort();
      await active;
      return {stopped:true};
    },
    status(){return Object.freeze({...current});}
  });
}
