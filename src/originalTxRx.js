/**
 * Compatibility client for the already deployed TX relay.
 * CapacitorHttp is injected by the Android caller to avoid WebView CORS.
 * Keys stay in memory only, are not logged or persisted, and are cleared on
 * closing the admin panel. This is NOT the unrelated Bridge SQL protocol.
 */
const ENDPOINT='https://tx-3dhs.onrender.com';
const HEX_ID=/^[a-f0-9-]{36}$/i;
export function createOriginalTxRx({request,endpoint=ENDPOINT}={}){
  if(typeof request!=='function'||endpoint!==ENDPOINT)
    throw Error('tx_rx_invalid_transport');
  let rxToken=null,txToken=null;
  const send=async(method,path,data)=>{
    if(!rxToken)throw Error('tx_rx_not_authenticated');
    let response;
    try{
      response=await request({
        url:endpoint+path,method,
        headers:{Authorization:'Bearer '+rxToken,Accept:'application/json',
          ...(data?{'Content-Type':'application/json'}:{})},
        ...(data?{data}:{ }),
        responseType:'json',connectTimeout:12000,readTimeout:32000
      });
    }catch{throw Error('tx_rx_network_unavailable');}
    if(response?.status===401||response?.status===403)
      throw Error('tx_rx_auth_denied');
    if(response?.status<200||response?.status>299)
      throw Error('tx_rx_http_'+String(response?.status||0));
    if(typeof response.data!=='object'||response.data===null)
      throw Error('tx_rx_invalid_response');
    return response.data;
  };
  const call=async body=>{
    const created=await send('POST','/v1/rx/request',body);
    if(!HEX_ID.test(created?.id))throw Error('tx_rx_invalid_job');
    for(let i=0;i<6;i++){
      const result=await send('GET','/v1/rx/result/'+created.id);
      if(result.pending===true)continue;
      if(result.ok!==true)throw Error('tx_rx_job_failed');
      return result;
    }
    throw Error('tx_rx_timeout');
  };
  return Object.freeze({
    async connect(rx,tx){
      if(typeof rx!=='string'||typeof tx!=='string'||
        rx.length<32||rx.length>256||tx.length<32||tx.length>256||rx===tx)
        throw Error('tx_rx_invalid_credentials');
      rxToken=rx;txToken=tx;
      try{
        const check=await send('GET','/v1/pair/pending');
        if(!Array.isArray(check.requests))throw Error('tx_rx_invalid_response');
        return true;
      }catch(error){rxToken=null;txToken=null;throw error;}
    },
    connected:()=>!!rxToken,
    async pending(){
      const data=await send('GET','/v1/pair/pending');
      if(!Array.isArray(data.requests))throw Error('tx_rx_invalid_response');
      return data.requests;
    },
    async approve(id){
      if(!HEX_ID.test(id)||!txToken)throw Error('tx_rx_not_authenticated');
      const data=await send('POST','/v1/pair/approve/'+id,{txToken});
      if(data.approved!==true)throw Error('tx_rx_approval_failed');
      return true;
    },
    async list(path='',offset=0){
      if(typeof path!=='string'||path.length>1024||path.includes('\0')||
        !Number.isSafeInteger(offset)||offset<0)throw Error('tx_rx_invalid_path');
      const data=await call({op:'list',path,offset,limit:100});
      if(!Array.isArray(data.entries)||typeof data.hasMore!=='boolean')
        throw Error('tx_rx_invalid_response');
      for(const entry of data.entries){
        if(typeof entry?.path!=='string'||typeof entry.name!=='string'||
           typeof entry.directory!=='boolean')throw Error('tx_rx_invalid_response');
      }
      return {entries:data.entries,hasMore:data.hasMore};
    },
    async read(path,offset){
      if(typeof path!=='string'||!path||path.length>1024||path.includes('\0')||
        !Number.isSafeInteger(offset)||offset<0)throw Error('tx_rx_invalid_path');
      const data=await call({op:'read',path,offset,length:32768});
      if(typeof data.base64!=='string'||!Number.isSafeInteger(data.nextOffset)||
         !Number.isSafeInteger(data.totalBytes)||typeof data.complete!=='boolean')
        throw Error('tx_rx_invalid_response');
      return data;
    },
    disconnect(){rxToken=null;txToken=null;}
  });
}
