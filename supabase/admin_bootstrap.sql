-- FreePT - attivazione iniziale amministratore.
-- DA ESEGUIRE SOLO NEL SQL EDITOR DEL PROGETTO FREEPT,
-- dopo la creazione dell'utente email/password in Supabase Authentication.
-- Non crea account Auth e non cambia i profili degli altri utenti.
--
-- 1) Sostituire i due segnaposto con email e cellulare dell'amministratore.
-- 2) Prima dell'esecuzione verificare che sia il proprio account.
-- 3) Non utilizzare un profilo anonimo o una richiesta di accesso come admin.

do $freept$
declare
  v_email text := 'SOSTITUIRE_EMAIL_ADMIN';
  v_phone text := 'SOSTITUIRE_TELEFONO_ADMIN';
  v_id uuid;
  v_count integer;
begin
  if v_email='SOSTITUIRE_EMAIL_ADMIN'
     or v_phone='SOSTITUIRE_TELEFONO_ADMIN' then
    raise exception 'Sostituire email e numero amministratore prima di procedere';
  end if;
  if v_phone !~ '^\\+[1-9][0-9]{7,14}$' then
    raise exception 'Numero non valido: usare formato internazionale +39...';
  end if;
  select count(*), max(id) into v_count, v_id
    from auth.users
    where lower(email)=lower(v_email)
      and coalesce(is_anonymous,false)=false;
  if v_count<>1 or v_id is null then
    raise exception 'Account email non trovato o non univoco: nessuna modifica';
  end if;
  if exists(select 1 from public.profiles where id=v_id and role='user' and status='approved') then
    raise exception 'Account già approvato come utente: verificare manualmente';
  end if;
  if exists(select 1 from public.profiles where id<>v_id and role='admin') then
    raise exception 'Un altro amministratore esiste già: verificare manualmente';
  end if;
  insert into public.profiles(id,full_name,phone,role,status)
  values(v_id,'Amministratore FreePT',v_phone,'admin','approved')
  on conflict(id) do update
    set role='admin',status='approved'
    where public.profiles.phone=v_phone;
  if not found then
    raise exception 'Profilo esistente con numero diverso: nessuna modifica';
  end if;
  raise notice 'Profilo amministratore configurato: %', v_id;
end $freept$;
