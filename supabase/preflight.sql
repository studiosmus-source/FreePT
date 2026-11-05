-- FreePT - diagnosi SOLA LETTURA del database.
-- Eseguire nel SQL Editor Supabase dopo schema + migrazione accessi.
-- Non modifica dati, ruoli, impostazioni o account.
-- Esito "OK" non prova da solo il funzionamento remoto: fare il test sui telefoni.
with checks as (
  select 'Tabella profili' as controllo,
    to_regclass('public.profiles') is not null as superato
  union all select 'Tabella messaggi',
    to_regclass('public.messages') is not null
  union all select 'RLS profili attiva',
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.profiles')),false)
  union all select 'RLS messaggi attiva',
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.messages')),false)
  union all select 'Policy richiesta utente presente',
    exists(select 1 from pg_policies where schemaname='public'
      and tablename='profiles' and policyname='profiles self request')
  union all select 'Permesso inserimento nome',
    has_column_privilege('authenticated','public.profiles','full_name','INSERT')
  union all select 'Permesso inserimento telefono',
    has_column_privilege('authenticated','public.profiles','phone','INSERT')
  union all select 'Policy approvazione admin',
    exists(select 1 from pg_policies where schemaname='public'
      and tablename='profiles' and policyname='profiles approve')
  union all select 'Policy lettura messaggi',
    exists(select 1 from pg_policies where schemaname='public'
      and tablename='messages' and policyname='messages read')
  union all select 'Policy invio messaggi',
    exists(select 1 from pg_policies where schemaname='public'
      and tablename='messages' and policyname='messages write')
  union all select 'Bucket allegati privato',
    exists(select 1 from storage.buckets where id='attachments' and public=false)
  union all select 'Amministratore approvato presente',
    exists(select 1 from public.profiles p join auth.users u on p.id=u.id
      where p.role='admin' and p.status='approved'
        and u.email is not null and coalesce(u.is_anonymous,false)=false)
  union all select 'Realtime messaggi pubblicato',
    exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='messages')
)
select controllo, case when superato then 'OK' else 'DA CONFIGURARE' end as esito
from checks order by controllo;
-- Il provider "Anonymous Sign-ins" va controllato anche nella dashboard:
-- Authentication > Providers > Anonymous Sign-ins. La sola query non lo prova.
