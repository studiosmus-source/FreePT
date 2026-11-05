-- FreePT: cancellazione chat o utente, riservata all'amministratore.
-- Eseguire UNA VOLTA nel SQL Editor prima di installare l'APK con questi comandi.
-- Non cancella dati all'installazione: si attiva solo dopo una conferma in app.
-- Lo Storage si elimina tramite Storage API, mai con DELETE su storage.objects.
alter table public.profiles
  add column if not exists chat_hidden_at timestamptz;

-- Soltanto l'amministratore approvato puo' eliminare i file via Storage API.
grant delete on storage.objects to authenticated;
drop policy if exists "attachments admin delete" on storage.objects;
create policy "attachments admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id='attachments' and (select public.freept_is_admin()));

-- Non concedere DELETE diretto sulle tabelle e sugli account Auth.
-- L'RPC controlla l'identita' dell'admin, il destinatario e il ruolo.
create or replace function public.freept_admin_delete_conversation(
  p_user_id uuid,
  p_delete_user boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  if (select auth.uid()) is null or not (select public.freept_is_admin()) then
    raise exception 'Accesso negato' using errcode='42501';
  end if;
  if p_user_id is null or p_user_id=(select auth.uid()) then
    raise exception 'Utente non valido' using errcode='22023';
  end if;
  select role into target_role
    from public.profiles
    where id=p_user_id
    for update;
  if not found then
    raise exception 'Utente inesistente' using errcode='P0002';
  end if;
  if target_role <> 'user' then
    raise exception 'Non e'' possibile eliminare un amministratore'
      using errcode='42501';
  end if;

  if p_delete_user then
    -- La rimozione da auth.users elimina profilo e messaggi tramite FK CASCADE.
    -- Non modifica/ elimina l'identita' amministratore.
    delete from auth.users where id=p_user_id;
    if not found then
      raise exception 'Account Auth non trovato' using errcode='P0002';
    end if;
  else
    delete from public.messages where user_id=p_user_id;
    update public.profiles
      set chat_hidden_at=clock_timestamp()
      where id=p_user_id;
  end if;
end;
$$;

revoke all on function public.freept_admin_delete_conversation(uuid,boolean)
  from public, anon;
grant execute on function public.freept_admin_delete_conversation(uuid,boolean)
  to authenticated;

-- La funzione non deve essere invocata da utenti anonimi in attesa o approvati:
-- auth.uid() e freept_is_admin() effettuano il controllo sul server.
