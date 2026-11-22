-- FreePT Bridge staging only: keep explicitly queued work available long
-- enough for Android's FCM/JobScheduler recovery window.
-- No production database or existing job rows are changed.

create or replace function public.bridge_staging_job_delivery_window()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    if new.state='queued' and
       new.operation in ('list','read','browse','thumbnail') then
      -- The periodic Android fallback is scheduled every 15 minutes and may
      -- be delayed by Doze/OEM policy. Keep a bounded 30-minute window.
      new.expires_at:=greatest(
        new.expires_at,clock_timestamp()+interval '30 minutes'
      );
    end if;
  elsif tg_op='UPDATE' then
    if old.state is distinct from 'done' and new.state='done' and
       new.operation='read' then
      -- Completed chunk bytes are temporary server-side transfer data.
      new.expires_at:=least(
        new.expires_at,clock_timestamp()+interval '5 minutes'
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bridge_staging_job_delivery_window()
  from public,anon,authenticated;
grant execute on function public.bridge_staging_job_delivery_window()
  to service_role;

drop trigger if exists bridge_staging_job_delivery_window
  on public.bridge_jobs;
create trigger bridge_staging_job_delivery_window
  before insert or update on public.bridge_jobs
  for each row execute function public.bridge_staging_job_delivery_window();
