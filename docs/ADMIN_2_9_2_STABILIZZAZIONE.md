# FreePT TEST 2.9.2-admin — stabilizzazione (25/11/2026)

Solo APK amministratore (`it.freept.bridge.next`, versionCode 22, firma esistente).
Nessuna modifica a server Render, database Supabase, autorizzazioni, TX remoto o OTA.

## Verifiche preliminari (fatti)

- APK 2.9.1 fornito: package `it.freept.bridge.next`, versionCode 21, `2.9.1-admin`,
  certificato SHA-256 `7F9A7A4B…DACE06F6`, identico a quello della 2.8.0.
- Il bundle JS dell'APK 2.9.1 è **byte-identico** alla build del commit
  `68d7b77` con le variabili del workflow (sha256 `e2479761…eaf8089`).
- Servizio Render live: commit `2b1ce15` (branch `work/unified-verified-20261119`).

## Causa dei 5xx / `bridge_backend_unavailable` (dimostrata con log e dati)

1. `bridge_server_enqueue_read` e `bridge_server_enqueue_browse` autorizzano un handle
   solo se la pagina `list/browse` che lo ha pubblicato è `done` e non scaduta.
2. Le pagine completate scadono **~300 s** dopo il completamento
   (`bridge_jobs`, ultimi 2 giorni: 182 browse `done`, TTL min 300,2 s, mediana 301 s).
3. L'app tiene in memoria le pagine senza limite di tempo: dopo 5 minuti nella
   stessa cartella ogni lettura (miniatura, anteprima, blocco di download) o apertura
   di sottocartella è rifiutata con SQL 42501 → PostgREST 403.
4. L'adapter (`postgresJobsAdapter.#rpc`) trasforma l'errore in
   `bridge_jobs_database_unavailable`; l'handler admin lo mappa sul default
   **HTTP 500** → client `bridge_backend_unavailable` → trattato come transitorio.
5. Il 25/11 (00:00–09:40 UTC): **77/493** `enqueue_read` e **7/196** `enqueue_browse`
   rifiutati (403 PostgREST); su Render gli stessi istanti risultano `admin/read` e
   `admin/browse` con 500 in 150–350 ms (es. 07:25, 08:07, 08:43, 09:02 UTC).
   La finestra controllata in precedenza (09:38–09:48 CET) non li conteneva.

## Cause della lentezza (dimostrate / stimate)

- **Limite globale 180 richieste/min** nel gateway (`httpsGateway.mjs`), condiviso
  da admin e TX. Log 06:18 UTC: 429 `rate_limited` anche su `tx/connect` e `tx/poll`.
  Stima (non misurata): ogni blocco da 256 KiB costa ~7–8 richieste fra admin e TX.
- **Miniature**: ogni foto ≤ 8 MiB veniva scaricata intera (fino a 32 lavori remoti)
  solo per una miniatura 144 px; la coda remota del TX è unica (FIFO).
- **Lavori orfani**: l'app interrompeva la richiesta HTTP di accodamento in volo
  (log `admin/read` `aborted` dopo 4–38 ms): il lavoro poteva restare in coda sul TX.
- Ogni poll del TX esegue 5 RPC Supabase in sequenza (~250 ms) — lato server, non
  modificato.

## Modifiche (solo client amministratore)

| File | Modifica |
|---|---|
| `src/bridgeHandleLeases.js` (nuovo) | Ricorda quale pagina ha pubblicato ogni handle; dopo 240 s richiede di nuovo **la stessa pagina** con un normale lavoro browse (il server ri-autorizza secondo le sue regole). Rinnovo a catena verso la radice. Su 500 da accodamento: un solo rinnovo forzato + un solo nuovo tentativo. Se il TX è stato riavviato, lo stesso nome/tipo/dimensione nella stessa pagina viene associato al nuovo handle; altrimenti errore esplicito `bridge_remote_item_changed`. L'accodamento non viene più interrotto in volo: se l'utente annulla, il lavoro creato viene cancellato. |
| `src/bridgeThumbnailClient.js` | JPEG: prima la miniatura EXIF (1 lavoro da 64 KiB); file intero solo se ≤ 1,5 MiB. PNG/WebP/GIF solo se ≤ 1,5 MiB. Ritaglio quadrato centrato (prima immagine deformata). Immagine già scaricata mostrata anche se nel frattempo parte il caricamento di un'altra pagina (prima restava nascosta). Un solo nuovo tentativo ritardato per errori temporanei. Cache in memoria 120 voci. |
| `src/bridgeThumbnailStore.js` (nuovo) | Cache persistente IndexedDB delle sole miniature 144 px: chiave SHA-256 (nessun nome file su disco), max 1500 voci / 24 MB, scadenza 21 giorni, eliminazione per dispositivi non più autorizzati e totale al logout. |
| `src/bridgeTransferManager.js` (nuovo) | Un download alla volta gestito dall'app, non dal pannello: tornare alla chat o cambiare persona non lo interrompe. Banner fisso con avanzamento, Riprendi, Interrompi. Messaggi d'errore in italiano. |
| `src/bridgeRemoteFilesUi.js` | Scansione e revisione cartella restano nel pannello; il trasferimento passa al gestore. Miniature in pausa durante un download. Messaggi leggibili. |
| `src/main.js` | Collegamento dei moduli; logout e uscita dall'area admin interrompono il download e (logout) svuotano la cache miniature. |

## Test eseguiti (simulati, non su telefono)

- `node --test bridge/*.test.mjs src/*.test.mjs`: **565/565** (548 preesistenti + 17 nuovi).
- `python3 -m unittest discover -s android-bridge`: 27/27.
- `vite build` con le variabili del workflow: riuscita.
- **Non eseguiti qui**: build Gradle/firma (segreti solo su GitHub), collaudo reale su
  telefono admin + TX. Vanno verificati dopo il push.

## Limiti residui (dichiarati)

- Download in background: gira nella WebView; Android può sospenderlo se l'app resta
  a lungo in background. Manca un servizio foreground nativo con notifica di sistema
  per l'admin (richiede codice nativo e nuovi permessi: intervento separato).
- Ripresa: per le cartelle restano conservati i file completati e si riprende dal file
  interrotto; un singolo file interrotto riparte da zero (nessuna ripresa a byte).
- Una miniatura in cache non rileva un file sostituito con stesso nome e stessa
  dimensione (il catalogo remoto non espone date di modifica).
- Il limite di 180 richieste/min e il costo dei poll TX restano: vanno corretti sul server.

## Raccomandazioni server (NON applicate, richiedono autorizzazione e deploy)

1. In `adminRequestHandler`, mappare gli errori SQL `bridge_read_handle_denied` /
   `bridge_browse_handle_denied` su un codice distinto (es. 410 `handle_expired`)
   invece del 500 generico: è un esito di autorizzazione atteso, non un guasto.
2. Sostituire il contatore globale 180/min con limiti per principale (TX vs admin)
   o escludere `tx/poll`/`tx/chunk` del dispositivo autenticato dal tetto comune.
3. Unire le 5 RPC del poll TX (`assert_tx_session` + 4 `claim_*`) in una sola.

## 2.9.3-admin — i file completati restano sempre (25/11/2026, richiesta utente)

Problemi trovati nel codice 2.9.2:
- App chiusa/uccisa da Android durante una cartella: al riavvio `recoverPending()`
  **cancellava** l'intera cartella temporanea, file completi compresi.
- Errori non di rete (sessione, file cambiato, scrittura): la cartella veniva scartata.
- Crash tra la rinomina finale e la rimozione del journal: la cartella già completa
  poteva essere cancellata al riavvio.

Correzioni (`BridgeDestinationPlugin`, `folderReceiver.mjs`):
- Cartella visibile durante il download: `Nome (in corso)`.
- Ogni file è scritto con nome temporaneo nascosto e rinominato al suo nome reale
  appena verificato: un file col nome reale è sempre completo.
- Al riavvio dopo una chiusura forzata: eliminati solo i file temporanei a metà;
  i file completi vengono pubblicati in `Nome (interrotto)`; l'app lo segnala.
- Qualsiasi errore con almeno un file completo: `Nome (parziale)`. Se anche la
  pubblicazione fallisce, nulla viene cancellato (recupero al riavvio).
- Journal con stato `published`: una cartella già pubblicata non viene mai cancellata.
- Cartelle interrotte con versioni precedenti: recuperate, con avviso che l'ultimo
  file potrebbe essere incompleto (allora i file avevano subito il nome reale).

Limite: un singolo file (non cartella) interrotto a metà non viene conservato,
perché sarebbe incompleto.
