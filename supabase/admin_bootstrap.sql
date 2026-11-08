-- FreePT: assegna il ruolo amministratore a un account email esistente.
-- Impostare entrambi i valori sotto, dopo aver creato l'utente in Authentication.
-- Non inserire qui password, token o chiavi Supabase.
do $freept$
declare
  v_email text := 'SOSTITUIRE_EMAIL_ADMIN';
  v_phone text := 'SOSTITUIRE_TELEFONO_ADMIN';
  v_id uuid;
begin
  if v_email = 'SOSTITUIRE_EMAIL_ADMIN'
     or v_phone = 'SOSTITUIRE_TELEFONO_ADMIN' then
    raise exception 'Sostituire email e telefono prima di procedere';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Telefono non valido, usare formato +39...';
  end if;
  select id into strict v_id
  from auth.users
  where lower(email) = lower(v_email)
    and coalesce(is_anonymous, false) = false;
  if exists(
    select 1 from public.profiles
    where role = 'admin' and id <> v_id
  ) then
    raise exception 'Altro amministratore gia presente: verificare manualmente';
  end if;
  insert into public.profiles(id,full_name,phone,role,status)
  values(v_id,'Amministratore FreePT',v_phone,'admin','approved')
  on conflict (id) do update
    set role='admin',status='approved'
    where public.profiles.phone=v_phone
      and public.profiles.role in ('admin','user');
  if not found then
    raise exception 'Profilo presente con numero diverso: nessuna modifica';
  end if;
  raise notice 'Amministratore associato all account %', v_id;
exception
  when no_data_found then
    raise exception 'Email non trovata tra gli utenti Auth non anonimi';
  when too_many_rows then
    raise exception 'Email duplicata: verificare manualmente';
end $freept$;
