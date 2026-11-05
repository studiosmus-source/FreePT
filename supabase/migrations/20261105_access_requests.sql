-- FreePT: migrazione per richieste di accesso senza account utente visibile.
-- Eseguire nel SQL Editor del progetto FreePT DOPO lo schema originale.
-- Necessario abilitare Supabase Auth > Anonymous Sign-ins.
-- L'identita' anonima e' legata all'installazione e non verifica il numero dichiarato.

create or replace function public.create_freept_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- L'accesso anonimo senza nome/telefono crea soltanto auth.users.
  -- Il profilo pending verra' creato dalla richiesta esplicita nell'app.
  if nullif(new.raw_user_meta_data->>'full_name','') is not null
     and nullif(new.raw_user_meta_data->>'phone','') is not null then
    insert into public.profiles(id,full_name,phone)
    values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone');
  end if;
  return new;
end; $$;

-- Gli utenti anonimi autenticati possono creare UN SOLO profilo:
-- il proprio, con ruolo user e stato pending. Non possono approvarsi.
grant insert(id,full_name,phone) on public.profiles to authenticated;
drop policy if exists "profiles self request" on public.profiles;
create policy "profiles self request" on public.profiles
  for insert to authenticated
  with check (
    id=(select auth.uid())
    and role='user'
    and status='pending'
    and (select auth.jwt()->>'is_anonymous')='true'
  );

-- Questa migrazione lascia invariati i permessi su messaggi e allegati:
-- gli utenti pending e blocked non possono leggerli ne' inviarli.
-- La sola policy di UPDATE e' riservata all'amministratore approvato.
-- Nota: la colonna phone UNIQUE resta in vigore. Senza SMS non certifica
-- il possesso del numero e una persona puo' dichiararne uno altrui.
