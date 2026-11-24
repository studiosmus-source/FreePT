# Diagnostica delle richieste Bridge TEST

## Stato e attivazione

Modifica preparata localmente, **non distribuita e non attivata su Render**.
Nessuna migrazione SQL, modifica delle autorizzazioni o modifica APK.
L'integrazione riguarda solo la composizione del server staging: il server
production non attiva questo logger.

L'attivazione richiede una successiva autorizzazione sia alla distribuzione del
codice TEST sia all'impostazione sul solo servizio TEST:

`FREEPT_BRIDGE_DIAGNOSTICS=STAGING_METADATA_V1`

Senza questo valore il logger rimane disattivato. Un valore non riconosciuto
interrompe esplicitamente l'avvio, invece di simulare una diagnostica attiva.
Per disattivarlo, rimuovere la variabile e riavviare il servizio secondo la
normale procedura autorizzata. Nessuna chiave API Render serve al logger.

## Cosa registra

Una riga JSON per evento, con `event=bridge_request` e `version=1`.
Solo operazioni POST appartenenti all'elenco fisso di route Bridge:

- `received`: la richiesta è arrivata al gateway.
- `dispatched`: il gateway ha passato il JSON al gestore; **non significa
  che l'autenticazione sia già riuscita**.
- `handler_waiting`: il gestore non ha ancora restituito una risposta dopo
  dieci secondi. Non equivale al timeout del telefono.
- `result`: il gestore ha prodotto una risposta, con codice HTTP, eventuale
  errore tecnico riconosciuto e stato del lavoro quando disponibili.
- `finished`: la risposta HTTP è stata scritta; non è una conferma di
  ricezione o visualizzazione da parte dell'app.
- `aborted`: la connessione si è chiusa prima del normale completamento.

Gli stati `queued`, `sent`, `done`, `cancelled`, `expired` sono riportati
solo se restituiti dal gestore. Nei poll TX riusciti, `hasJob` distingue un
poll vuoto da un lavoro consegnato al worker. Una risposta di errore non è
classificata come poll vuoto.

`request` è un identificativo generato sul server per la singola richiesta.
`job` e `device` sono riferimenti pseudonimi HMAC, non gli identificativi
originali. Consentono di seguire richiesta admin, poll del telefono,
consegna del risultato e successiva lettura admin all'interno dello stesso
processo. La chiave HMAC è casuale, solo in memoria, mai stampata e rigenerata
a ogni avvio. `instance` distingue i processi: **non correlare riferimenti
tra istanze o riavvii**. Non si mantengono mappe di dispositivi o lavori.

## Protezione e limiti

Non vengono stampati header, token, credenziali, ID originali, nomi, numeri
telefonici, percorsi, handle, elenchi di cartelle, file, immagini, contenuti,
messaggi di eccezione o corpi JSON. Gli errori non riconosciuti diventano
`unclassified_error`. Le URL arbitrarie e le query string non sono stampate.

Il logger limita il proprio volume a 1.200 eventi al minuto per processo.
Gli eventi eccedenti sono scartati **senza bloccare le richieste**. Alla
successiva finestra con attività, `phase=suppressed` riporta quanti eventi
sono stati omessi. Non aggiunge limiti a ricerca, navigazione o download e
non cambia timeout, limiti HTTP esistenti, risposte o autenticazione.

Health check, risorse statiche e preflight OPTIONS non sono registrati.
Un errore del sink di log non deve impedire le operazioni del Bridge.

Questi log non osservano direttamente FCM, JobScheduler, Doze o il codice
nativo Android. Un lavoro che rimane `queued` non prova da solo che il
telefono non si sia risvegliato: vanno considerate istanze, riavvii e
soppressione dei log. Questa modifica migliora la diagnosi; **non costituisce
una correzione dimostrata del timeout sul telefono remoto**.

## Verifica locale

`node --test bridge/requestDiagnostics.test.mjs bridge/httpsGateway.test.mjs bridge/httpsStagingServer.test.mjs`

I test usano server HTTP locali, gestori simulati e dati sintetici, senza
connettersi a Render, Supabase o ai telefoni.
