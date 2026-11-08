# FreePT Bridge — servizio HTTPS di prova separato

**Stato:** gateway HTTPS predisposto nel ramo sperimentale e verificato in CI.
Non è ancora installato su Render né collegato a telefoni reali. Non equivale
a un download remoto funzionante.

## Isolamento obbligatorio

- Repository: `studiosmus-source/FreePT`
- Branch: `feature/bridge-admin-foundation-20261106`
- Root directory servizio: radice del repo FreePT
- Build command: `npm ci --omit=dev` oppure `npm install --omit=dev`
- Start command: `npm run bridge:serve:staging`
- Runtime: Node 22+.
- **Creare un servizio Render NUOVO, distinto dal servizio TX esistente**.
- HTTPS deve essere terminato dal proxy gestito Render, con
  `x-forwarded-proto` **sovrascritto dal proxy**: l'header non è di per sé
  prova crittografica se il listener Node fosse raggiungibile direttamente.
- UNA istanza in staging; il rate limiter di processo non è distribuito.
- Nessun collegamento al Supabase FreePT di produzione.

## Variabili di ambiente del solo servizio (mai VITE_)

```text
FREEPT_BRIDGE_STAGING=I_UNDERSTAND_LOCAL_TEST_ONLY
FREEPT_BRIDGE_PUBLIC=I_UNDERSTAND_STAGING_HTTPS_ONLY
FREEPT_BRIDGE_READ_ENABLED=I_UNDERSTAND_TEST_ONLY
FREEPT_BRIDGE_ALLOWED_ORIGINS=https://localhost
FREEPT_BRIDGE_TEST_SUPABASE_URL=<isolated-staging-url>
FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY=<isolated-staging-publishable>
FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY=<isolated-staging-secret>
PORT=<injected-by-Render>
```

La stringa `LOCAL_TEST_ONLY` rimane intenzionalmente richiesta dal validatore
Supabase già esistente: il secondo interruttore `FREEPT_BRIDGE_PUBLIC` abilita
la modalità HTTPS sotto il reverse proxy. Entrambi devono essere presenti.
Il segreto `SERVICE_ROLE_KEY` non deve mai finire nell'APK, nei log,
nelle variabili `VITE_*`, nei file GitHub o nei parametri URL.
Il server rifiuta esplicitamente l'host Supabase di produzione.

Non distribuire prima di aver applicato e verificato tutte le migrazioni
Bridge **nel progetto Supabase di prova**, nell'ordine coperto dalla pipeline
`.github/workflows/bridge-checks.yml`. Il workflow attuale usa un
PostgreSQL effimero: **non applica migrazioni al progetto Supabase remoto**.

## Configurazione dell'APK isolato

Soltanto dopo aver verificato l'URL HTTPS del servizio e i suoi controlli,
inserire nella variabile di repository GitHub Actions:

```text
FREEPT_BRIDGE_TEST_API_URL=https://<nuovo-servizio-bridge>.onrender.com
```

Poi ricompilare soltanto il ramo sperimentale: il workflow
`.github/workflows/android-debug.yml` valida che il valore sia HTTPS e
diverso dal dominio Supabase di produzione. Se questa variabile è vuota,
il client Bridge non crea un collegamento remoto e non inventa fallback.

## Confini e operazioni

Le rotte consentite sono soltanto:
- admin: `list`, `status`, `cancel`, `folder`; con flag read esplicito anche `read`, `chunk`;
- proprietario: `enroll`, `delete`;
- trasmittente: `connect`, `poll`, `complete`, `folder`, `disconnect`; con flag read esplicito anche `chunk`.

Il gateway applica HTTPS, CORS rigoroso per `https://localhost`, un
limite globale di richieste per minuto per istanza e limiti ai body.
Autenticazione Supabase, credenziale TX, sessione e grant vengono
controllati dai servizi e dal database già esistenti. Nessun path del
filesystem, esecuzione di comandi o archivio di file è esposto dal gateway.

**Limiti residui:** il servizio HTTPS non è stato distribuito o testato
con credenziali del progetto Supabase di prova; manca ancora un reale
trasferimento di byte, la navigazione delle sottocartelle e il download
delle cartelle; nessun collaudo funzionale su due dispositivi è stato eseguito.
Su più istanze serviranno rate limiting e gestione sessioni condivisi.

## Criteri prima della prima prova reale

1. Verificare URL Render, isolamento dei segreti, certificato HTTPS,
   header proxy e esatta origin Android.
2. Verificare migrazioni sulla base staging, permessi per ruolo
   e revoche senza accesso alle tabelle chat.
3. Verificare l'APK `it.freept.bridge` e il dispositivo di prova,
   poi registrazione, scelta cartella, grant, comando esplicito,
   recupero elenco, revoca e riconnessione.
4. Non migrare nulla su `main`, TX su Render o Supabase produzione
   finché il collaudo reale non è approvato.

## Protocollo `read` sperimentale — branch receiver 2026-11-08

Il codice è presente ma **disabilitato per impostazione predefinita**.
Prima di impostare `FREEPT_BRIDGE_READ_ENABLED`, applicare SOLO nel database
Bridge isolato la migrazione
`supabase/migrations/20261108_bridge_read_chunks_staging.sql`, **dopo**
`20261108_bridge_folder_catalog_staging.sql` e la session fence.
Il flag non va inserito nelle variabili `VITE_*`, nell'APK o sul servizio TX.

Flusso attuale: un admin approvato richiede `/bridge/admin/read` per un
handle file proveniente da un recente catalogo root; il TX autenticato ottiene
il job con `poll`, legge fino a 32768 byte con SAF e li consegna a
`/bridge/tx/chunk`. Il ricevente autenticato li recupera da
`/bridge/admin/chunk`. Il database revalida consenso, sessione TX e job,
e rifiuta letture dopo revoca. La coda PostgreSQL è unica, senza TX legacy.

**Non è ancora un download Android utilizzabile:** mancano il salvataggio
streaming sul dispositivo ricevente, l'orchestrazione automatica dei job
ripetuti per file grandi, il catalogo remoto delle sottocartelle e il deploy
separato di HTTPS/Supabase staging. Il modello di ricezione delle cartelle è
locale ma non ancora collegato al server. Nessun test tra telefoni è attestato.
La pipeline GitHub prova le operazioni su PostgreSQL effimero, non sul Supabase
staging remoto; il workflow Android resta volutamente disabilitato su questo
branch fino all'integrazione sicura del ricevitore.
