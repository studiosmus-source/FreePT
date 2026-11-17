-- DRAFT for isolated test database only, AFTER bridge_foundation.sql.
-- A trusted backend must issue a 256-bit token using a CSPRNG, derive its
-- salted SHA-256 verifier using the domain tag from deviceCredentials.mjs,
-- and store ONLY its salt/verifier here. Never store a raw bearer secret.
--
-- This table is deliberately inaccessible to both owner and admin clients.
-- It is NOT a registration API, secure pairing protocol or HTTP endpoint.

create table if not exists public.bridge_device_verifiers (
  device_id uuid primary key references public.bridge_devices(id) on delete cascade,
  salt_hex text not null check (salt_hex ~ '^[0-9a-f]{32}$'),
  verifier_hex text not null check (verifier_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz not null default clock_timestamp()
);

alter table public.bridge_device_verifiers enable row level security;
revoke all on public.bridge_device_verifiers from public, anon, authenticated;
-- No client SELECT policy, even for an admin or the device owner.
-- The service-role backend must check the authenticated owner and device
-- authorization before issuing, rotating or revoking one verifier.
-- Server state must be checked on every session establishment and reauth.
