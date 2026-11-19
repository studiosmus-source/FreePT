-- Only the new isolated bootstrap tables; no legacy constraint or user data modified.
begin;
alter table public.bridge_bootstrap_devices drop constraint bridge_bootstrap_devices_admin_id_fkey;
alter table public.bridge_bootstrap_devices add constraint bridge_bootstrap_devices_admin_id_fkey foreign key(admin_id) references public.profiles(id) on delete cascade;
alter table public.bridge_bootstrap_devices drop constraint bridge_bootstrap_devices_owner_id_fkey;
alter table public.bridge_bootstrap_devices add constraint bridge_bootstrap_devices_owner_id_fkey foreign key(owner_id) references public.profiles(id) on delete cascade;
commit;
