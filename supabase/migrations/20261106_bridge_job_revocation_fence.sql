-- ADDITIVE STAGING DRAFT. Apply AFTER bridge_jobs_staging,
-- bridge_job_admin_staging and the existing owner controls migrations.
-- A grant revocation / device switch OFF must atomically cancel pending and
-- dispatched jobs, permanently clearing their TX session binding.
--
-- Owner RPCs lock bridge_devices FIRST, then modify grants. Dispatch and
-- completion acquire the same device lock before taking a job lock.
-- Direct service_role updates outside that locking convention remain a
-- deployment hazard; this migration does not solve profile-status races.
-- This is a protected trigger helper, not a browser-callable RPC.
create or replace function public.bridge_cancel_jobs_on_consent_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'bridge_grants' then
    if old.revoked_at is null and new.revoked_at is not null then
      update public.bridge_jobs
        set state = 'cancelled', session_binding_hex = null,
            updated_at = clock_timestamp()
        where device_id = new.device_id
          and receiver_id = new.receiver_id
          and state in ('queued', 'sent');
    end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'bridge_devices' then
    if old.bridge_enabled = true and new.bridge_enabled = false then
      update public.bridge_jobs
        set state = 'cancelled', session_binding_hex = null,
            updated_at = clock_timestamp()
        where device_id = new.id
          and state in ('queued', 'sent');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bridge_cancel_jobs_on_consent_change()
  from public, anon, authenticated;
drop trigger if exists bridge_cancel_jobs_on_grant_revoke
  on public.bridge_grants;
create trigger bridge_cancel_jobs_on_grant_revoke
  after update of revoked_at on public.bridge_grants
  for each row execute function public.bridge_cancel_jobs_on_consent_change();

drop trigger if exists bridge_cancel_jobs_on_owner_off
  on public.bridge_devices;
create trigger bridge_cancel_jobs_on_owner_off
  after update of bridge_enabled on public.bridge_devices
  for each row execute function public.bridge_cancel_jobs_on_consent_change();

-- This does not erase completed jobs or revoke TX credentials. A trusted
-- backend still needs shared session epochs/fencing and presence validation.
