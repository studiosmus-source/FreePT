-- FreePT staging only; corresponding migration already applied to aqjuixbuxftnjfzxmzuj.
-- NEVER apply to production. The role retains no broad INSERT privileges.
CREATE OR REPLACE FUNCTION public.freept_auth_e2e_provision_fixture(p_user_id uuid,p_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE e text; n text; phone_value text;
BEGIN
 IF p_kind NOT IN ('admin','user') OR p_user_id IS NULL THEN RETURN false; END IF;
 e:='freept-auth-e2e-'||p_kind||'-20261119-02@tests.freept.invalid';
 n:='FreePT TEST E2E '||p_kind||' 20261119-02';
 phone_value:=CASE p_kind WHEN 'admin' THEN '+999202611190021' ELSE '+999202611190022' END;
 IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_user_id AND u.email=e AND
  u.raw_app_meta_data->>'freept_test_fixture'='AUTH_E2E_NEW_FIXTURES_20261119_02' AND
  u.created_at>='2026-11-19 00:00:00+00'::timestamptz) THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_user_id) THEN RETURN false; END IF;
 INSERT INTO public.profiles(id,full_name,phone,role,status)
 VALUES(p_user_id,n,phone_value,CASE p_kind WHEN 'admin' THEN 'admin' ELSE 'user' END,
 CASE p_kind WHEN 'admin' THEN 'approved' ELSE 'pending' END);
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.freept_auth_e2e_provision_fixture(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.freept_auth_e2e_provision_fixture(uuid,text) TO service_role;
