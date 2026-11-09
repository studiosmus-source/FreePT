/** Dedicated FreePT production Bridge. Fails closed without explicit config. */
import {createBridgeProductionService} from './productionServer.mjs';
const service=createBridgeProductionService({env:process.env});
await service.start();
process.stdout.write('Dedicated FreePT production Bridge started behind HTTPS proxy\n');
let stopping=false;
async function stop(){
  if(stopping)return;
  stopping=true;
  await service.stop();
}
for(const signal of ['SIGINT','SIGTERM'])
  process.once(signal,()=>void stop().then(()=>process.exit(0),()=>process.exit(1)));
