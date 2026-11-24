/**
 * Conservative classification for transient Bridge backend transport failures.
 * Fail closed for PostgreSQL authorization (e.g. 42501), malformed responses,
 * unknown failures, and device/session revocations.
 *
 * Only known gateway 502/503/504 or recognized transport aborts are retryable.
 * No database error messages or credential details leave the server.
 */
const TEMPORARY_HTTP=new Set([502,503,504]);
const TRANSPORT_NAMES=new Set(['AbortError','TimeoutError']);
export function retryableBackendFailure(error, responseStatus){
  if(TEMPORARY_HTTP.has(responseStatus) &&
     error && typeof error==='object' &&
     error.code!=='42501' && error.code!=='PGRST301')return true;
  if(!error || typeof error!=='object')return false;
  if(TRANSPORT_NAMES.has(error.name))return true;
  const code=error.cause?.code;
  return ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENETUNREACH','EAI_AGAIN'].includes(code);
}
export function backendFailure(label,error,responseStatus){
  const failure=new Error(label);
  if(retryableBackendFailure(error,responseStatus))failure.retryable=true;
  return failure;
}
