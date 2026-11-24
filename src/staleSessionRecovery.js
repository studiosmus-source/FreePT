/** A deleted anonymous account can leave an obsolete local Supabase session.
 * Never clear sessions for network failures or valid accounts.
 */
export function isConfirmedDeletedAuthUser(error){
  if(!error)return false;
  const status=Number(error.status);
  const code=String(error.code||'').toLowerCase();
  const message=String(error.message||'').toLowerCase();
  return (status===401||status===403) &&
    (code==='user_not_found'||code==='user_deleted'||
     /user from sub claim.*does not exist|user.*not found|user.*does not exist/.test(message));
}
export async function obtainRequestUser(auth){
  const {data:sessionData,error:sessionError}=await auth.getSession();
  if(sessionError)throw sessionError;
  let user=sessionData?.session?.user||null;
  if(user){
    const {data:verified,error}=await auth.getUser();
    if(error||!verified?.user){
      if(!isConfirmedDeletedAuthUser(error))throw error||Error('Sessione non verificabile: riprova');
      // Only confirmed deletion: terminate local session and acquire a fresh
      // anonymous account. Do not revoke other devices.
      const signedOut=await auth.signOut({scope:'local'});
      if(signedOut.error)throw signedOut.error;
      user=null;
    }else user=verified.user;
  }
  if(!user){
    const next=await auth.signInAnonymously();
    if(next.error)throw next.error;
    user=next.data?.user;
  }
  if(!user?.is_anonymous)throw Error('Una sessione amministratore è già attiva.');
  return user;
}
