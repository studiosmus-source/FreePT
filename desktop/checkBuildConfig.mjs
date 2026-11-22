const supabaseUrl=process.env.VITE_SUPABASE_URL||'';
const publishableKey=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
const bridgeUrl=process.env.VITE_BRIDGE_TEST_API_URL||'';
let parsed;
try{parsed=new URL(supabaseUrl);}catch{
  console.error('Isolated TEST configuration missing or invalid');
  process.exit(1);
}
if(parsed.protocol!=='https:'||
   parsed.hostname!=='aqjuixbuxftnjfzxmzuj.supabase.co'||
   parsed.username||parsed.password||parsed.search||parsed.hash||
   (parsed.pathname!==''&&parsed.pathname!=='/')||
   publishableKey.length<30||
   bridgeUrl!=='https://freept-bridge-staging.onrender.com'){
  console.error('Isolated TEST configuration missing or invalid');
  process.exit(1);
}
console.log('Isolated TEST configuration validated');
