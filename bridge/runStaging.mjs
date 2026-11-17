import {startBridgeStagingServer} from './stagingServer.mjs';

// Starts only with explicit test-project config, and binds to 127.0.0.1.
// No public network exposure, file operations, or production project fallback.
const {server,url}=await startBridgeStagingServer();
process.stdout.write('FreePT Bridge staging listening on '+url+' (loopback only)\n');
let stopping=false;
async function stop(){
  if(stopping)return;
  stopping=true;
  await server.stop();
}
for(const signal of ['SIGINT','SIGTERM'])
  process.once(signal,()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));});
