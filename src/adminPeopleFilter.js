/**
 * Pure, local-only admin list filters. No server writes or new permissions.
 * Retains original order (pending first, then most recent conversation).
 */
export function filterAdminPeople(people, query='', status='all'){
  const term=String(query??'').trim().toLocaleLowerCase('it-IT');
  const state=['all','pending','approved','blocked'].includes(status)?status:'all';
  return people.filter(person=>{
    if(state!=='all'&&person.status!==state)return false;
    if(!term)return true;
    return [person.full_name,person.phone]
      .some(value=>String(value??'').toLocaleLowerCase('it-IT').includes(term));
  });
}
