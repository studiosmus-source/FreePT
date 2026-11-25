/**
 * Receiver-side renewal of Bridge handle authorization.
 *
 * The TEST backend authorizes a read (and a sub-folder browse) only while the
 * completed list/browse page that published the handle is still valid:
 * bridge_jobs.expires_at = completion + 300 s (measured on 25/11/2026).
 * Older handles are rejected by the database (42501) and the gateway turns
 * that into HTTP 500, i.e. `bridge_backend_unavailable` in the client.
 *
 * This wrapper NEVER bypasses that check. It remembers which page published
 * each handle and, before the page lease runs out, asks the remote phone for
 * the same page again through the normal authorized browse job. The server
 * then authorizes the handles again by its own rules.
 *
 * It also stops orphaning jobs: an enqueue request is never aborted while in
 * flight (the job could exist without anybody reading it). If the caller has
 * cancelled meanwhile, the created job is cancelled explicitly.
 *
 * Only metadata already held in memory is kept here (no disk persistence).
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Renew well before the 300 s server lease (job completion can trail request).
export const BRIDGE_PAGE_LEASE_MS=240000;
const PENDING_JOB_MS=300000;

const cancelled=()=>Error('bridge_transfer_cancelled');

export function withBridgeHandleLeases(api,{
  now=Date.now,leaseMs=BRIDGE_PAGE_LEASE_MS,maxPages=400,
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=1200,maxWaitMs=70000
}={}){
  if(!api||['requestBrowse','getBrowsePage','getStatus','requestRead','cancel']
     .some(key=>typeof api[key]!=='function'))return api;
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1||!Number.isSafeInteger(maxPages)||maxPages<1)
    throw Error('bridge_lease_invalid_options');
  /** pageKey -> {deviceId,parent,offset,at,entries:Map(handle->{name,directory,size})} */
  const pages=new Map();
  /** device|handle -> pageKey that last published it */
  const owners=new Map();
  /** device|oldHandle -> device-current handle for the same name (TX restart) */
  const aliases=new Map();
  /** jobId -> {deviceId,parent,offset,at} for browse jobs whose page is not read yet */
  const jobs=new Map();
  const refreshing=new Map();
  const pageKey=(deviceId,parent,offset)=>deviceId+'|'+parent+'|'+offset;
  const ref=(deviceId,handle)=>deviceId+'|'+handle;

  const record=(meta,entries)=>{
    const key=pageKey(meta.deviceId,meta.parent,meta.offset);
    const previous=pages.get(key);
    const next=new Map();
    for(const entry of entries){
      next.set(entry.handle,{name:entry.name,directory:entry.directory,size:entry.size});
      owners.set(ref(meta.deviceId,entry.handle),key);
    }
    if(previous){
      // A restarted remote service may publish new opaque handles for the same
      // items. Map old -> new only for an identical name/type/size in the same
      // folder page; anything else is treated as changed, never guessed.
      for(const [oldHandle,old] of previous.entries){
        if(next.has(oldHandle))continue;
        let replacement=null;
        for(const [handle,item] of next){
          if(item.name===old.name&&item.directory===old.directory&&
             (old.directory||item.size===old.size)){replacement=handle;break;}
        }
        const oldRef=ref(meta.deviceId,oldHandle);
        if(replacement){aliases.set(oldRef,replacement);owners.set(oldRef,key);}
        else{aliases.delete(oldRef);owners.delete(oldRef);}
        // Keep older aliases pointing at the current handle (single hop).
        for(const [aliasRef,target] of aliases){
          if(target!==oldHandle||!aliasRef.startsWith(meta.deviceId+'|'))continue;
          if(replacement)aliases.set(aliasRef,replacement);
          else{aliases.delete(aliasRef);owners.delete(aliasRef);}
        }
      }
    }
    pages.delete(key);
    pages.set(key,{deviceId:meta.deviceId,parent:meta.parent,offset:meta.offset,at:meta.at,entries:next});
    while(pages.size>maxPages){
      const [oldestKey,oldest]=pages.entries().next().value;
      pages.delete(oldestKey);
      for(const handle of oldest.entries.keys()){
        const r=ref(oldest.deviceId,handle);
        if(owners.get(r)===oldestKey)owners.delete(r);
      }
    }
  };

  const resolve=(deviceId,handle)=>aliases.get(ref(deviceId,handle))??handle;

  // Same protocol as the UI lister: one browse job, bounded polling.
  const browseAgain=async(deviceId,parent,offset,signal)=>{
    // Goes through the wrapped requestBrowse below: it renews `parent` itself
    // first when needed, then records the new page.
    const job=await wrapped.requestBrowse(deviceId,{handle:parent,offset},{signal});
    const startedAt=now();
    let done=false;
    try{
      for(;;){
        if(signal?.aborted)throw cancelled();
        const status=await api.getStatus(job.jobId,{signal});
        if(status?.jobId!==job.jobId||status.deviceId!==deviceId)
          throw Error('bridge_lease_job_mismatch');
        if(status.state==='done')break;
        if(status.state==='expired')throw Error('bridge_remote_browse_expired');
        if(status.state!=='queued'&&status.state!=='sent')
          throw Error('bridge_remote_browse_cancelled');
        if(now()-startedAt>=maxWaitMs)throw Error('bridge_remote_browse_timeout');
        await pause(pollMs);
      }
      await wrapped.getBrowsePage(job.jobId,{signal});
      done=true;
    }finally{
      if(!done){try{await api.cancel(job.jobId);}catch{/* final, revoked or offline */}}
    }
  };

  const refreshPage=(key,signal)=>{
    let running=refreshing.get(key);
    if(!running){
      const page=pages.get(key);
      if(!page)return Promise.resolve();
      running=browseAgain(page.deviceId,page.parent,page.offset,signal)
        .finally(()=>refreshing.delete(key));
      refreshing.set(key,running);
    }
    return running;
  };

  /** Returns the handle to use now; renews its publishing page when stale. */
  const ensure=async(deviceId,handle,signal,force=false)=>{
    if(handle==='root')return handle;
    let current=resolve(deviceId,handle);
    const key=owners.get(ref(deviceId,current));
    if(!key)return current; // Not seen by this client: the server decides.
    const page=pages.get(key);
    if(!page)return current;
    if(!force&&now()-page.at<leaseMs)return current;
    await refreshPage(key,signal);
    if(signal?.aborted)throw cancelled();
    current=resolve(deviceId,handle);
    const renewed=pages.get(owners.get(ref(deviceId,current)));
    if(!renewed||!renewed.entries.has(current))throw Error('bridge_remote_item_changed');
    return current;
  };

  const known=(deviceId,handle)=>owners.has(ref(deviceId,resolve(deviceId,handle)));

  // Enqueue without an abort signal; cancel the created job if the caller
  // gave up meanwhile. A timeout inside the HTTP client still applies.
  const enqueue=async(run,signal)=>{
    if(signal?.aborted)throw cancelled();
    const result=await run();
    if(signal?.aborted){
      if(UUID.test(result?.jobId)){try{await api.cancel(result.jobId);}catch{/* ignore */}}
      throw cancelled();
    }
    return result;
  };

  const wrapped={
    ...api,
    async requestBrowse(deviceId,{handle='root',offset=0}={},{signal}={}){
      let current=await ensure(deviceId,handle,signal);
      for(let attempt=0;;attempt++){
        const at=now();
        try{
          const result=await enqueue(()=>api.requestBrowse(deviceId,{handle:current,offset}),signal);
          if(UUID.test(result?.jobId)){
            for(const [jobId,meta] of jobs)if(at-meta.at>PENDING_JOB_MS)jobs.delete(jobId);
            jobs.set(result.jobId,{deviceId,parent:current,offset,at});
          }
          return result;
        }catch(error){
          // A rejected enqueue rolls back in the database: no job was created.
          if(attempt===0&&error?.message==='bridge_backend_unavailable'&&
             current!=='root'&&known(deviceId,current)){
            current=await ensure(deviceId,current,signal,true);continue;
          }
          throw error;
        }
      }
    },
    async getBrowsePage(jobId,options){
      const page=await api.getBrowsePage(jobId,options);
      const meta=jobs.get(jobId);
      if(meta&&Array.isArray(page?.entries)){jobs.delete(jobId);record(meta,page.entries);}
      return page;
    },
    async requestRead(deviceId,request,{signal}={}){
      let handle=await ensure(deviceId,request?.handle,signal);
      for(let attempt=0;;attempt++){
        try{
          return await enqueue(()=>api.requestRead(deviceId,{...request,handle}),signal);
        }catch(error){
          if(attempt===0&&error?.message==='bridge_backend_unavailable'&&known(deviceId,handle)){
            handle=await ensure(deviceId,handle,signal,true);continue;
          }
          throw error;
        }
      }
    },
    /** Forget everything learned for a device (explicit refresh, revocation). */
    forgetDevice(deviceId){
      for(const [key,page] of pages)if(page.deviceId===deviceId)pages.delete(key);
      for(const map of [owners,aliases])
        for(const key of map.keys())if(key.startsWith(deviceId+'|'))map.delete(key);
      for(const [jobId,meta] of jobs)if(meta.deviceId===deviceId)jobs.delete(jobId);
    }
  };
  return Object.freeze(wrapped);
}
