#!/usr/bin/env bash
# Disposable PostgreSQL CI race regression. No external database connections.
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

device='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
# The contract test left this device OFF and a queued job in place.
psql -v ON_ERROR_STOP=1 -c "UPDATE public.bridge_devices SET bridge_enabled=true WHERE id='$device'" >/dev/null

# Session A locks device, then signals the test runner before sleeping.
cat >"$tmp/locker.sql" <<SQL
\set ON_ERROR_STOP on
begin;
select id from public.bridge_devices where id='$device' for update;
\! touch $tmp/held
select pg_sleep(3);
update public.bridge_devices set bridge_enabled=false where id='$device';
commit;
SQL
psql -v ON_ERROR_STOP=1 -f "$tmp/locker.sql" >"$tmp/locker.log" 2>&1 &
pid=$!
for i in $(seq 1 100); do
  if [[ -f "$tmp/held" ]]; then break; fi
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$tmp/locker.log"; exit 1
  fi
  sleep 0.05
done
if [[ ! -f "$tmp/held" ]]; then
  echo 'FAILED: lock was never acquired'; exit 1
fi

# Session B must wait on the SAME device lock; lock_timeout proves it cannot
# claim while the owner change is uncommitted.
if psql -v ON_ERROR_STOP=1 -c "SET lock_timeout='400ms'; SELECT public.bridge_server_claim_list('$device',repeat('a',64));" >"$tmp/blocked.log" 2>&1; then
  echo 'FAILED: claim passed an outstanding owner transaction'
  cat "$tmp/blocked.log"; exit 1
fi
if ! grep -q 'canceling statement due to lock timeout' "$tmp/blocked.log"; then
  echo 'FAILED: claim failed for a reason other than the expected lock timeout'
  cat "$tmp/blocked.log"; exit 1
fi

wait "$pid"
# After the owner turns Bridge OFF, the claim must still be refused.
if psql -v ON_ERROR_STOP=1 -c "SELECT public.bridge_server_claim_list('$device',repeat('a',64));" >"$tmp/off.log" 2>&1; then
  echo 'FAILED: claim accepted despite owner OFF'; exit 1
fi
grep -q 'bridge_unavailable' "$tmp/off.log"
echo 'bridge-postgres-concurrent-owner-off-ok'
