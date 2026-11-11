/**
 * One-shot, read-only production Bridge readiness probe.
 * Log only categorical states, never row content, identifiers, counts, or secrets.
 * No RPCs or database mutations: status can be checked without owner enrollment.
 */
const tables = Object.freeze([
  ['devices', 'bridge_devices', 'id'],
  ['grants', 'bridge_grants', 'device_id'],
  ['verifiers', 'bridge_device_verifiers', 'device_id']
]);

export async function inspectBridgeProductionData(db) {
  if (typeof db?.from !== 'function') throw Error('bridge_readiness_client_invalid');
  const result = {};
  for (const [key, table, column] of tables) {
    try {
      const response = await db.from(table).select(column, {head: true, count: 'exact'});
      const code = response?.error?.code;
      result[key] = code === 'PGRST205' || code === '42P01' ? 'missing'
        : code === '42501' || code === 'PGRST301' ? 'denied'
        : code === '42703' || code === 'PGRST204' ? 'schema_mismatch'
        : response?.error || !Number.isSafeInteger(response?.count) ? 'unavailable'
        : response.count === 0 ? 'empty' : 'present';
    } catch {
      result[key] = 'unavailable';
    }
  }
  try {
    const response = await db.from('profiles')
      .select('id', {head: true, count: 'exact'})
      .eq('role', 'admin').eq('status', 'approved');
    result.approvedAdmin = response?.error || !Number.isSafeInteger(response?.count)
      ? 'unavailable' : response.count === 1 ? 'unique' : response.count === 0 ? 'none' : 'multiple';
  } catch {
    result.approvedAdmin = 'unavailable';
  }
  return Object.freeze(result);
}
