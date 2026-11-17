/**
 * Backend-only Supabase admin verification adapter for the isolated Bridge.
 * No API routes, keys, live queries or client imports are created here.
 *
 * The caller supplies trusted SERVER-SIDE Supabase clients configured outside
 * this module. Do not put a service role key in FreePT's browser or Android app.
 * auth.getUser(token) verifies the supplied access token with Supabase Auth.
 * The profiles client must be server-controlled and allowed to read only the
 * requested role/status record. Never derive roles from JWT user_metadata.
 */
export function createSupabaseBridgeAdminAuthenticator({ authClient, profilesClient }) {
  if (typeof authClient?.auth?.getUser !== 'function' ||
      typeof profilesClient?.from !== 'function')
    throw new Error('invalid_admin_auth_dependencies');

  return async function authenticateAdmin(authContext) {
    const token = authContext?.accessToken;
    // The token must originate from a backend-validated Authorization header,
    // never from a user-selected id, role, or untrusted body property.
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192 ||
        /\s/.test(token))
      return null;

    try {
      const { data, error } = await authClient.auth.getUser(token);
      const user = data?.user;
      if (error || !user || typeof user.id !== 'string' || !user.id ||
          user.is_anonymous === true || user.app_metadata?.provider === 'anonymous')
        return null;

      const result = await profilesClient.from('profiles')
        .select('id,role,status')
        .eq('id', user.id)
        .maybeSingle();
      const profile = result?.data;
      if (result?.error || !profile || profile.id !== user.id ||
          profile.role !== 'admin' || profile.status !== 'approved')
        return null;

      return { id: user.id, role: 'admin', approved: true };
    } catch {
      // No misleading success on Auth outage, RLS error, or malformed response.
      return null;
    }
  };
}
