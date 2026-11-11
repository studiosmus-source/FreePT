/**
 * This module is loaded before the chat entrypoint. Capgo must be notified
 * immediately, before any network/authentication operations, for safe rollback.
 * The native updater is OFF unless the signed APK build explicitly enables it.
 */
import {Capacitor,registerPlugin} from '@capacitor/core';
import {reportOtaReady} from './otaReady.js';

if(Capacitor.isNativePlatform()){
  const updater=registerPlugin('CapacitorUpdater');
  void reportOtaReady(updater,true).then(ready=>{
    if(!ready)console.warn('FreePT: native OTA readiness unavailable');
  });
}
