/**
 * Browser configuration boundary for the isolated Bridge APK and CI build.
 * The ordinary FreePT application preserves its historical fallback.
 * The explicitly marked isolated build NEVER falls back to production.
 */
const PROD_HOST='cpopqsvzzxfjgnlawlvc.supabase.co';
const DEFAULT_URL='https://'+PROD_HOST;
const DEFAULT_KEY='sb_publishable_Q74UCgQUXO6f_7vZhXcbyg_2KRl2OSN';
const PUBLISHABLE=/^sb_publishable_[A-Za-z0-9_-]{16,}$/;

export function getFreePtSupabaseConfig({
  url, key, isolated=false
}={}) {
  if (!isolated) return Object.freeze({
    url:url||DEFAULT_URL,key:key||DEFAULT_KEY
  });
  let parsed;
  try {parsed=new URL(url);} catch {throw Error('isolated_supabase_url_required');}
  if(parsed.protocol!=='https:'||
     !/^[a-z0-9-]+\\.supabase\\.co$/.test(parsed.hostname)||
     parsed.hostname===PROD_HOST||parsed.username||parsed.password||
     parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash)
    throw Error('isolated_supabase_url_required');
  if(typeof key!=='string'||!PUBLISHABLE.test(key))
    throw Error('isolated_supabase_key_required');
  return Object.freeze({url:parsed.origin,key});
}
