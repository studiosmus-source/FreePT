/**
 * Explicit Windows desktop Bridge enrollment. No effect in Android or browsers.
 * The native host asks only after its owner presses "Attiva Bridge".
 * Supabase credentials are passed once in-memory to the locally bundled,
 * origin-checked WebView2 host and are never written to disk or chat.
 */
export function installWindowsBridgeEnrollment({auth,getIdentity}={}){
  if(typeof window==='undefined'||window.location?.hostname!=='app.freept.test'||
     typeof window.chrome?.webview?.addEventListener!=='function'||!auth||!getIdentity)return;
  window.chrome.webview.addEventListener('message',async event=>{
    const data=event?.data;
    if(data?.kind!=='freept_win_pair_request'||
       typeof data.nonce!=='string'||!/^[a-f0-9]{32}$/.test(data.nonce))return;
    const reply={kind:'freept_win_pair_response',nonce:data.nonce,accessToken:null};
    try{
      const identity=getIdentity();
      if(identity?.role==='user'&&identity.status==='approved'&&identity.id){
        const {data:session,error}=await auth.getSession();
        if(!error&&session?.session?.user?.id===identity.id&&
           typeof session.session.access_token==='string'&&session.session.access_token.length>20)
          reply.accessToken=session.session.access_token;
      }
    }catch{/* fail closed */}
    window.chrome.webview.postMessage(reply);
  });
}
