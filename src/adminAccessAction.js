/**
 * Restrict admin status changes to reversible suspension/reactivation.
 * The server's profiles UPDATE(status) privilege and RLS are authoritative.
 */
export function adminAccessAction(status){
  if(status==='approved')return {next:'blocked',label:'Sospendi',question:'Sospendere l’accesso di questo utente?'};
  if(status==='blocked')return {next:'approved',label:'Riattiva',question:'Riattivare l’accesso di questo utente?'};
  return null;
}
