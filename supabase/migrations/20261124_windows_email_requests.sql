-- TEST only: Windows users may request access with name and email instead of phone.
-- Existing Android profiles and grants are preserved, no data changes.
alter table public.profiles add column if not exists email text;
alter table public.profiles alter column phone drop not null;
alter table public.profiles add constraint profiles_email_format_check check (
 email is null or (char_length(email) between 5 and 254
 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
);
alter table public.profiles add constraint profiles_one_contact_check check (
 (phone is not null and email is null) or (phone is null and email is not null)
);
create unique index if not exists profiles_email_unique_idx on public.profiles(lower(email))
 where email is not null;
grant insert(id,full_name,phone,email) on public.profiles to authenticated;
