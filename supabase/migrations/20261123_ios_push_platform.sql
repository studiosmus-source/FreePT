-- iOS push tokens use APNs; Android tokens continue to use FCM.
-- Safe schema-only extension: no existing rows, RLS policies or tokens removed.
alter table public.push_devices
  drop constraint if exists push_devices_platform_check;
alter table public.push_devices
  add constraint push_devices_platform_check
  check (platform in ('android','ios'));
create index if not exists push_devices_platform_user_idx
  on public.push_devices(platform,user_id);
