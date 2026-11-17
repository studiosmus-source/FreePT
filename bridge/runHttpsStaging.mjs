/**
 * Dedicated service ONLY. Requires explicit opt-in, isolated Supabase and a
 * managed HTTPS reverse proxy. Never run as the existing TX Render service.
 */
import {createBridgeStagingHttpsService} from './httpsStagingServer.mjs';

const service=createBridgeStagingHttpsService({env:process.env});
await service.start();
process.stdout.write('Isolated FreePT Bridge HTTPS gateway ready behind proxy\n');
let stopping=false;
const stop=async()=>{
  if(stopping)return;
  stopping=true;
  await service.stop();
};
for(const signal of ['SIGINT','SIGTERM'])
  process.once(signal,()=>void stop().then(()=>process.exit(0),()=>process.exit(1)));
