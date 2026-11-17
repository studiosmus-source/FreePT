# Bridge / TX — verifica riuso codice (8 novembre 2026)

## Sorgenti verificati

- FreePT: ramo `feature/bridge-admin-foundation-20261106`, client
  `src/bridgeAdminClient.js` e `src/bridgeTxFolderClient.js`,
  provider Android `android-bridge/BridgeFilesPlugin.java.template`,
  endpoint `bridge/*` e SQL `supabase/migrations/20261108_bridge_folder_catalog_staging.sql`.
- TX: repo `studiosmus-source/TX`, ramo `main`,
  `relay/server.mjs`, `relay/rx-cli.mjs`, `rx/README.md`.
- Il servizio Render esistente `TX` usa la repository TX / `main`,
  con URL `https://tx-3dhs.onrender.com`.

## Risultato

TX dispone già di un trasporto remoto a job:
- `POST /v1/rx/request` crea comandi `list`, `read`, `gallery`,
  `thumb`, `preview`;
- `GET /v1/tx/next` consegna il lavoro al telefono TX;
- `POST /v1/tx/result/:id` inoltra i risultati al ricevitore;
- `GET /v1/rx/result/:id` consegna il risultato al ricevente;
- file grandi sono letti per blocchi (nel protocollo TX, massimo 512 KiB).

**Non riutilizzare direttamente i token TX_TOKEN / RX_TOKEN
nell'APK FreePT.** Il relay TX su `main` usa due segreti condivisi e
una coda globale, mentre Bridge è progettato per identità per-dispositivo,
grant individuale, revoca e controllo del ruolo admin lato backend.

Il relay TX preesistente non va modificato né riavviato nel tentativo di
accelerare il Bridge. Potrebbe servire altri telefoni.

## Componenti reali già aggiunti a Bridge

1. Provider Android SAF: scelta esplicita cartella, permesso revocabile,
   navigazione e lettura a blocchi locale; **niente accesso remoto automatico**.
2. RPC PostgreSQL di catalogo cartella su DB isolato:
   scrittura solo da TX autenticato in job valido,
   lettura solo da admin autorizzato, invalidata da revoca.
3. Handler loopback di test e client amministratore di lettura elenco.
4. Client TX sperimentale `createBridgeFolderTransmitter`:
   non parte automaticamente e richiede `deviceId` + `deviceSecret`
   già provisioning; non salva il segreto né avvia servizi in background.
5. CI: test unitari, composizione HTTP e migrazioni PostgreSQL usa
   un database temporaneo, non il Supabase di produzione.

## Blocchi ancora aperti prima del reale trasferimento tra telefoni

- Registrazione del telefono Bridge autenticata dal suo proprietario,
  emissione protetta della credenziale del solo dispositivo e pairing/grant
  revocabile: **non** copiare la chiave TX condivisa già in Render.
- Backend Bridge HTTPS **separato** e collegato esclusivamente al Supabase
  di prova, con secret lato server, CORS/origin restrittivo, rate limiting,
  throttling e audit. Il listener loopback non va esposto pubblicamente.
- Avvio TX esplicito su Android, canale di connessione sostenibile e
  notifiche foreground quando necessarie; nessuna attività invisibile.
- Navigazione remota delle sottocartelle, paginazione e identificatori
  durevoli rispetto ai riavvii; attualmente si tratta solo della prima
  pagina della cartella scelta.
- Richieste e trasferimento **dei byte dei file** con chunk autenticati,
  limiti, verifica integrità, annullamento, revoca durante i trasferimenti
  e download su Android ricevente.
- Collaudo su due telefoni diversi, rete mobile/Wi-Fi, grant revocato,
  disconnessione, riavvio, Android 15/16 e regressioni FreePT.

## Regola di rilascio

Una build APK verde certifica soltanto compilazione e test CI. Non
dimostra il trasferimento remoto di un file o un'intera cartella.
Non modificare il progetto Supabase FreePT originale, la repository TX,
il suo relay Render o i segreti già in uso durante queste prove.
