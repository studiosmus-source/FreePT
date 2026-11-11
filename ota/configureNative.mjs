/** Called by the unified APK build before npx cap add/sync. */
import {readFileSync,writeFileSync} from 'node:fs';
import {configureNativeUpdater} from './nativeConfig.mjs';
const filename='capacitor.config.json';
const original=JSON.parse(readFileSync(filename,'utf8'));
const updated=configureNativeUpdater(original,{
  enable:process.env.FREEPT_OTA_ENABLED||'',
  url:process.env.FREEPT_OTA_UPDATE_URL||''
});
writeFileSync(filename,JSON.stringify(updated,null,2)+'\n');
console.log('FreePT OTA native mode:',updated.plugins.CapacitorUpdater.autoUpdate);
