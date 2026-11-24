-- FreePT TEST only. Preserve existing authorization and protect other profiles.
-- FK probes during deletion should not require table scans.
create index if not exists messages_sender_fk_idx on public.messages(sender_id);
create index if not exists important_alerts_sender_fk_idx on public.important_alerts(sender_id);
create index if not exists bridge_grants_receiver_fk_idx on public.bridge_grants(receiver_id);
create index if not exists bridge_audit_events_receiver_fk_idx on public.bridge_audit_events(receiver_id);

create or replace function public.freept_admin_delete_conversation(
  p_user_id uuid,
  p_delete_user boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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
    from public.profiles where id=p_user_id for update;
  if not found then
    raise exception 'Utente inesistente' using errcode='P0002';
  end if;
  if target_role <> 'user' then
    raise exception 'Non e'' possibile eliminare un amministratore'
      using errcode='42501';
  end if;

  if p_delete_user then
    -- Messages in other users' conversations must never be silently removed.
    if exists(select 1 from public.messages
      where sender_id=p_user_id and user_id<>p_user_id) then
      raise exception 'Messaggi collegati ad altre conversazioni: cancellazione non eseguita'
        using errcode='23503';
    end if;
    -- Explicitly remove the user's own chat before deleting profiles.
    -- messages.sender_id has a RESTRICT/NO ACTION FK to profiles.
    delete from public.messages where user_id=p_user_id;
    delete from auth.users where id=p_user_id;
    if not found then
      raise exception 'Account Auth non trovato' using errcode='P0002';
    end if;
  else
    delete from public.messages where user_id=p_user_id;
    update public.profiles set chat_hidden_at=clock_timestamp()
      where id=p_user_id;
  end if;
end;
$function$;
revoke all on function public.freept_admin_delete_conversation(uuid,boolean)
  from public, anon;
grant execute on function public.freept_admin_delete_conversation(uuid,boolean)
  to authenticated;
