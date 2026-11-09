/** Production Bridge entrypoint. Fail closed until the dedicated production
 * Supabase credentials, origin policy and server implementation are audited.
 * Never fall back to staging or TX.
 */
throw new Error('freept_bridge_production_not_configured');
