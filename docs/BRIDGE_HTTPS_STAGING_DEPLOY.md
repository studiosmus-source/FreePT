# FreePT Bridge — HTTPS staging e Android (2026-11-08)

## Stato verificato

- Fonte autorevole: branch `feature/bridge-chunk-receiver-20261108` del repository `studiosmus-source/FreePT`.
- Build JavaScript/PostgreSQL/browser: CI automatica su PostgreSQL effimero.
- APK Android `it.freept.bridge`: build GitHub Actions di staging riuscita;
  separato da `it.freept.app`.
- Il workflow Android ha confermato **Supabase di prova** e rifiutato l'host
  Supabase di produzione.
- Il workflow Android ha anche confermato che **FREEPT_BRIDGE_TEST_API_URL
  non è configurato**: l'APK generato NON può collegarsi ad alcun server
  Bridge pubblico. Non è stato effettuato un download fra due telefoni.
- Nessuna migrazione applicata tramite CI a un database Supabase remoto.
  Nessun deploy Render effettuato.

## Isolamento obbligatorio del backend HTTPS

Creare un **nuovo** servizio Render web, non modificare TX o FreePT produzione.
Il servizio deve usare esclusivamente il branch indicato sopra:

- Runtime Node.js 22 o superiore; directory root del repository;
- Install: `npm ci --omit=dev` (oppure `npm install --omit=dev`);
- Start: `npm run bridge:serve:staging`;
- Una sola istanza con reverse proxy HTTPS gestito, senza accesso esterno
  diretto alla porta Node. Il reverse proxy deve sovrascrivere
  `x-forwarded-proto`, non fidarsi degli header arbitrari del client.
- Nessun accesso a Supabase FreePT produzione e nessun segreto nell'APK.

Variabili **solo del servizio server**, mai `VITE_*`:

```text
FREEPT_BRIDGE_STAGING=I_UNDERSTAND_LOCAL_TEST_ONLY
FREEPT_BRIDGE_PUBLIC=I_UNDERSTAND_STAGING_HTTPS_ONLY
FREEPT_BRIDGE_READ_ENABLED=I_UNDERSTAND_TEST_ONLY
FREEPT_BRIDGE_ALLOWED_ORIGINS=https://localhost
FREEPT_BRIDGE_TEST_SUPABASE_URL=<URL PROGETTO SUPABASE TEST>
FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE TEST>
FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY=<SEGRETO TEST, SOLO SERVER>
PORT=<PORT ASSEGNATA DA RENDER>
```

Il validatore del server rifiuta esplicitamente l'host Supabase di produzione.
Il rate limit HTTP è per singola istanza di processo; usare una sola istanza
in questa fase.

## Migrazioni nel SOLO database PostgreSQL/Supabase di prova

L'ordine completo e verificato dalla CI è nel job
`bridge-postgres` di `.github/workflows/bridge-checks.yml`.
In particolare, dopo le migrazioni Bridge foundation, consensi, job e
sessioni TX, applicare **nell'ordine**:

1. `20261108_bridge_folder_catalog_staging.sql`
2. `20261108_bridge_read_chunks_staging.sql`
3. `20261108_bridge_browse_staging.sql`
4. `20261108_bridge_device_enrollment_staging.sql`

Non riapplicare le migrazioni già presenti senza controllo dello schema.
Le RPC di lettura/navigazione sono server-only; i telefoni non hanno
accesso diretto alle tabelle della coda o al service role.

Prima di abilitare `FREEPT_BRIDGE_READ_ENABLED` verificare che le
migrazioni di prova abbiano superato i controlli di sicurezza. Lo stesso
flag abilita le operazioni sperimentali `read` e `browse`.

## APK Android di staging

Workflow: `.github/workflows/bridge-android-staging.yml`.

Variabili **GitHub Actions** di test richieste:

```text
FREEPT_BRIDGE_TEST_SUPABASE_URL=<URL PROGETTO TEST>
FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE TEST>
FREEPT_BRIDGE_TEST_API_URL=https://<NUOVO SERVIZIO BRIDGE>.onrender.com
```

L'URL API va impostato **solo dopo** aver predisposto e verificato il nuovo
servizio HTTPS. Ricompilare l'APK: l'URL è inserito nel bundle web durante
la compilazione. Non inserire SERVICE_ROLE_KEY in GitHub variables,
`VITE_*`, APK, log o sorgenti. Il service role deve stare nei segreti
dell'ambiente server isolato.

Il workflow `bridge-android-smoke.yml` compila anche un APK puramente
diagnostico con Supabase fittizio, che non è adatto al collaudo reale.

## Procedura manuale fra telefoni Android

1. Installare l'APK di staging su due telefoni di prova.
2. Su A registrare il dispositivo, selezionare tramite Android SAF la
   **sola cartella da condividere**, attivare Bridge e autorizzare l'admin.
3. Su A premere **Avvia Bridge per 4 minuti** e mantenere l'app attiva.
   Il pulsante permette anche di interrompere la sessione.
4. Su B accedere come admin approvato, sbloccare l'area Bridge, scegliere
   la scheda **File**, selezionare con Android SAF la destinazione e
   aprire il dispositivo autorizzato.
5. Sfogliare le sottocartelle, scaricare un singolo file oppure la cartella
   intera, con tutte le sottocartelle. I nomi e i percorsi relativi
   vengono ricostruiti sotto la destinazione selezionata.
6. Verificare SHA-256/dimensioni dei file sul dispositivo reale, annullamento,
   revoca durante un trasferimento, file vuoti, cartelle vuote, reti lente
   e riapertura dell'app.

Le voci SAF del telefono proprietario ricevono identificatori opachi e
restano valide solo nella relativa sessione di processo. Il catalogo delle
cartelle completato scade dopo circa cinque minuti e la sessione TX dura
cinque minuti; l'app A serve richieste per massimo quattro minuti.
Trasferimenti lunghi o molto numerosi possono richiedere una nuova sessione
e una nuova navigazione. Il resume persistente non è ancora implementato.

## Limiti tecnici ancora da collaudare

Il protocollo trasporta al massimo **32 KiB per job di lettura** e mantiene
la coda unificata PostgreSQL. Le cartelle vengono preventivamente
enumerate per evitare una destinazione parziale prima di sapere cosa
scaricare. Il destinatario scrive in oggetti SAF temporanei, rinominati
alla fine; se il provider Android non supporta la rinomina atomica, il
download deve fallire senza essere dichiarato concluso.

Non sono stati eseguiti collaudi funzionali tra due telefoni via Internet.
Non dichiarare compatibilità con grandi cartelle, resume, lavoro in
background o performance prima dei test reali.

**Non alterare `main`, FreePT produzione, TX Render o Supabase produzione.**
