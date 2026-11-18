# FreePT OTA — canale TEST prima di STABILE

**Stato: codice preparatorio, non distribuito.** Nessun APK attualmente installato
riceve OTA senza un nuovo APK firmato contenente il plugin. Nessuna release OTA è
abilitata: entrambi i manifest hanno `"enabled": false`.

## Confini verificabili

- App: `it.freept.app` soltanto; stesso keystore stabile già usato dalla build unificata.
- Capacitor 7 richiede `@capgo/capacitor-updater@7`, non la release 8.
- Solo HTML/CSS/JavaScript possono essere aggiornati via OTA; Java, manifest,
  permission, Gradle, plugin e modifiche ai servizi Bridge nativi richiedono APK.
- Il codice nativo chiama `notifyAppReady()` appena possibile, prima di Supabase.
- L'endpoint è bloccato nella configurazione NATIVA, non modificabile da JavaScript.
- Niente scritture su Supabase, Storage, Render Bridge, chat, profili o utenti.
- Server separato, senza segreti Supabase. TEST selezionato da allowlist server-side
  di device_id del plugin. Tutti gli altri dispositivi ricevono solo STABILE.
- Il numero `nativeVersionCode` di ogni release deve coincidere esattamente
  con `version_code` mandato dall'APK. Per ogni nuova generazione nativa, cambiare
  versionCode e preparare nuovi bundle compatibili.
- Una release invalidata non viene distribuita, ma NON revoca automaticamente
  una versione già installata. L'auto-rollback nativo copre principalmente
  mancato avvio del bundle, non bug funzionali: serve collaudo con due telefoni.

## 1. Collaudo statico

`npm install --no-audit --no-fund`, `node --test ota/*.test.mjs src/otaReady.test.mjs`,
`npm run test:bridge`, `npm run build`, `npx cap add android`,
`npx cap sync android`, Gradle `assembleDebug` su ambiente CI.

La pipeline principale contiene una configurazione OTA **opt-in**. Senza
`FREEPT_OTA_ENABLED` e `FREEPT_OTA_UPDATE_URL` lascia OTA spento.
Non modificare la firma Android e non sostituire l'APK di produzione con
una debug random-key.

## 2. Server OTA separato

Manifest: `ota/manifests/test.json`, `ota/manifests/stable.json`.
Nuovo servizio Render separato, con start `node ota/server.mjs` e health `/health`.
Ambiente: `FREEPT_OTA_ENABLED=I_ACCEPT_FREEPT_OTA_SERVER`,
`FREEPT_OTA_TEST_DEVICE_IDS` (allowlist privata, stringa separata da virgole),
`PORT` gestito da Render. API: `POST https://<host>/updates`.

Non utilizzare il servizio Render di Bridge per ospitare gli aggiornamenti.
La configurazione Render non è un deployment automatico. I file ZIP sono
ospitati come asset immutabili di release GitHub, non sul filesystem effimero Render.

## 3. Confezione bundle

Usare **Capgo CLI**, non uno ZIP generico:
`npx @capgo/cli@latest bundle zip --path dist --json`.
Registrare versione semver e SHA-256 prodotto dalla CLI. Prima di pubblicare
verificare che il bundle non contenga segreti, variabili di staging o codice
nativo incompatibile. Caricare lo ZIP su una release del repository GitHub:
`https://github.com/studiosmus-source/FreePT/releases/download/<tag>/<file>.zip`.

Per TEST, autorizzare il device_id dell'APK amministratore nella allowlist
server-side; il plugin fornisce `getDeviceId()` sul dispositivo.
Aggiornare SOLO `ota/manifests/test.json`, dopo collaudo portare stesso
checksum/URL/versione a `ota/manifests/stable.json` e distribuire il server.
Entrambi restano disattivati finché non vi sono artifact e verifiche reali.

Formato manifest dopo approvazione (esempio, NON eseguibile così):
```json
{
  "enabled": true,
  "version": "1.0.1",
  "nativeVersionCode": 1,
  "url": "https://github.com/studiosmus-source/FreePT/releases/download/ota-v1.0.1/FreePT-web.zip",
  "checksum": "<64 caratteri esadecimali prodotti dalla CLI>"
}
```

La versione di STABILE deve essere rigorosamente successiva a quella già
installata: la promozione verso STABILE richiede una scelta manuale.
Per bloccare una diffusione, rimettere `enabled:false` e ridistribuire
il server; non equivale a un rollback per i telefoni già aggiornati.

## 4. Nuova APK iniziale (soltanto dopo server & TEST)

Nel workflow `freept-unified-apk.yml` impostare la variable GitHub
`FREEPT_OTA_ENABLED=I_ACCEPT_FREEPT_OTA` e
`FREEPT_OTA_UPDATE_URL=https://<host>/updates`.
La pipeline richiede HTTPS valido, nessuna credenziale nell'URL
e preserva `it.freept.app` e il keystore di firma stabile.

Installare su un telefono TEST e verificare: login, biometria, chat, notifiche,
Bridge TX/RX e file, OTA su riavvio, nessun cambio di sessione, rollback dopo
bundle volutamente non avviabile. Solo dopo distribuire agli altri.

NON confondere test unitari, build Android o controlli GitHub con collaudo reale.
