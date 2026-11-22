const CODE=/^[0-9a-f]{24}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePcLinkCode(value){
  const code=String(value??'').replace(/[\s-]/g,'');
  if(!CODE.test(code))throw Error('pc_link_code_invalid');
  return code.toUpperCase();
}

export function createPcAccountLink({db,auth}={}){
  if(typeof db?.rpc!=='function'||typeof auth?.getSession!=='function'||
     typeof auth?.signInAnonymously!=='function')
    throw Error('pc_link_dependencies_invalid');

  async function rpc(name,args){
    const result=await db.rpc(name,args);
    if(result?.error)throw result.error;
    return result?.data;
  }

  return Object.freeze({
    async start(deviceLabel='PC'){
      if(!['PC Windows','PC macOS','PC'].includes(deviceLabel))
        throw Error('pc_link_device_label_invalid');
      const session=await auth.getSession();
      if(session?.error)throw session.error;
      let user=session?.data?.session?.user;
      if(!user){
        const result=await auth.signInAnonymously();
        if(result?.error)throw result.error;
        user=result?.data?.user;
      }
      if(!user?.is_anonymous)throw Error('pc_link_anonymous_session_required');
      const code=await rpc('freept_pc_link_start',{p_device_label:deviceLabel});
      if(typeof code!=='string'||!CODE.test(code))
        throw Error('pc_link_response_invalid');
      return code.toUpperCase();
    },
    async approve(value){
      const code=normalizePcLinkCode(value);
      return (await rpc('freept_pc_link_approve',{p_code:code}))===true;
    },
    async list(){
      const rows=await rpc('freept_pc_link_list');
      return Array.isArray(rows)?rows:[];
    },
    async revoke(authUserId){
      if(!UUID.test(String(authUserId??'')))throw Error('pc_link_device_invalid');
      return (await rpc('freept_pc_link_revoke',{p_auth_user_id:authUserId}))===true;
    }
  });
}
