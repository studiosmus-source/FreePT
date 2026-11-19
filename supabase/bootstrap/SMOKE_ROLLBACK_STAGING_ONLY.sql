-- Execute only on FreePT-Bridge-Test. All synthetic writes are rolled back.
begin;
set local role service_role;
do $proof$
declare fixture_id uuid:=gen_random_uuid(); answer jsonb;
begin
 answer:=public.bridge_bootstrap_step('start',fixture_id,repeat('A',124),repeat('1',32),
  jsonb_build_object('pairHash',repeat('a',64),'challenge',repeat('b',64)),null);
 if answer->>'state' is distinct from 'pending' then raise exception 'pending proof failed'; end if;
 if exists(select 1 from public.profiles where profiles.id=fixture_id) then raise exception 'personal profile created'; end if;
 begin
  perform public.bridge_bootstrap_step('poll',fixture_id,repeat('A',124),repeat('1',32),'{}',null);
  raise exception 'replay accepted';
 exception when unique_violation then null;
 end;
 answer:=public.bridge_bootstrap_step('poll',fixture_id,repeat('A',124),repeat('2',32),'{}',null);
 if answer ? 'job' or answer->>'state' is distinct from 'pending' then raise exception 'unauthorized job'; end if;
end $proof$;
rollback;
