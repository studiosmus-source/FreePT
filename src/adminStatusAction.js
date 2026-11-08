/**
 * Reversible administrative access changes.
 * The database's UPDATE(status) permission and RLS remain authoritative.
 */
export function getAdminStatusAction(status) {
  if(status==='approved')
    return Object.freeze({next:'blocked',label:'Sospendi accesso',question:'Sospendere temporaneamente l’accesso di questo utente?'});
  if(status==='blocked')
    return Object.freeze({next:'approved',label:'Riattiva accesso',question:'Riattivare l’accesso di questo utente?'});
  return null;
}
