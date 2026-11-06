-- Read-only preflight for Bridge migration in a TEST Supabase project.
-- Do not apply migration here. Missing tables are expected until installed.
with checks as (
  select 'Dispositivi Bridge' as controllo,
    to_regclass('public.bridge_devices') is not null as superato
  union all select 'Autorizzazioni Bridge',
    to_regclass('public.bridge_grants') is not null
  union all select 'RLS dispositivi',
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.bridge_devices')), false)
  union all select 'RLS autorizzazioni',
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.bridge_grants')), false)
  union all select 'Client non modifica dispositivi',
    case when to_regclass('public.bridge_devices') is null then false
      else not has_table_privilege('authenticated','public.bridge_devices','INSERT')
        and not has_table_privilege('authenticated','public.bridge_devices','UPDATE')
        and not has_table_privilege('authenticated','public.bridge_devices','DELETE')
    end
  union all select 'Client non modifica autorizzazioni',
    case when to_regclass('public.bridge_grants') is null then false
      else not has_table_privilege('authenticated','public.bridge_grants','INSERT')
        and not has_table_privilege('authenticated','public.bridge_grants','UPDATE')
        and not has_table_privilege('authenticated','public.bridge_grants','DELETE')
    end
  union all select 'Funzione admin grant limitata',
    to_regprocedure('public.bridge_admin_has_active_grant(uuid)') is not null
  union all select 'Attivazione Bridge disponibile',
    coalesce(has_function_privilege(
      'authenticated', to_regprocedure('public.bridge_owner_set_enabled(uuid,boolean)'), 'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'anon', to_regprocedure('public.bridge_owner_set_enabled(uuid,boolean)'), 'EXECUTE'
    ), false)
  union all select 'Autorizzazione Bridge disponibile',
    coalesce(has_function_privilege(
      'authenticated', to_regprocedure('public.bridge_owner_grant(uuid,uuid)'), 'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'anon', to_regprocedure('public.bridge_owner_grant(uuid,uuid)'), 'EXECUTE'
    ), false)
  union all select 'Revoca Bridge disponibile',
    coalesce(has_function_privilege(
      'authenticated', to_regprocedure('public.bridge_owner_revoke(uuid,uuid)'), 'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'anon', to_regprocedure('public.bridge_owner_revoke(uuid,uuid)'), 'EXECUTE'
    ), false)
)
select controllo,
  case when superato then 'OK' else 'DA CONFIGURARE' end as esito
from checks
order by controllo;
