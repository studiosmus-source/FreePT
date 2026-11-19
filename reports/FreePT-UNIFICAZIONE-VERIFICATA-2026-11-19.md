# FreePT unificata — verifica del 19 novembre 2026

## Obiettivo e ambiente
Un solo APK Android con registrazione nome/telefono senza SMS, approvazione amministratore, chat, allegati e Bridge. Primo consenso esplicito alla condivisione della memoria condivisa, inclusi file nascosti; esclusione aree Android protette. Conservazione identità package e firma del TEST. Nessun deploy o cambiamento al database produzione.

Fonti realmente lette: repository completo studiosmus-source/FreePT, main 84b7dd0 e work/unified-verified-20261119 inizialmente 185f90e4891129aa351ac44624bf3d014d79a3dd; rapporto allegato; checkpoint, codice web, plugin e servizio Java, SQL, workflow, test e configurazione staging. Il nome dei rami non viene assunto come prova di funzionamento fisico.

## Correzioni consolidate
- La preparazione avviava solo l'identità sintetica e il dispose fermava il servizio: ora avvia il foreground TX e lo mantiene dopo il consenso.
- La vecchia promozione dipendeva da un codice bootstrap nascosto nella UI. Dopo approvazione chat si usa l'enrollment proprietario HTTPS già esistente, con credenziale in Keystore e grant controllato dal server. Il worker passa dalla corsia sintetica al TX file senza un altro codice o pulsante.
- L'approvatore è registrato server-side durante la vera approvazione. I nuovi telefoni sono collegati a quell'amministratore, anche quando esistono amministratori di collaudo. Per installazioni storiche senza approvatore, si richiede un unico amministratore reale; identità fixture marcate nel metadata server non sono destinatari impliciti.
- La pausa prodotta dalla vecchia chiusura onboarding si recupera solo prima del binding. I dispositivi già bound conservano pausa e revoche; nessuna riattivazione automatica di grant revocati.
- Il catalogo include nomi che iniziano con un punto. Esclude Android/data, Android/obb e symlink che potrebbero uscire dalla radice. Restano validi i limiti Android e i limiti di protocollo preesistenti: pagine da 100, massimo 10.000 voci per catalogo e profondità 32. Non è un accesso root né ai dati privati delle altre app; supporto volumi SD separati non verificato.
- Rimossi dal percorso automatico i vecchi tentativi di claim non più raggiungibili; resta il protocollo diagnostico amministratore separato.

## Database TEST corretto e verificato
Solo aqjuixbuxftnjfzxmzuj, FreePT-Bridge-Test ACTIVE_HEALTHY:
1. Migrazione esistente delete_chats_users: chat_hidden_at, preflight, RPC e policy Storage mancavano.
2. Tabella push_devices mancante: applicata la migrazione esistente con RLS; consegna push su telefono NON collaudata.
3. Registrazione dell'approvatore e selezione destinatario owner.
4. Migrazione esistente bridge_chunk_size_256k: SQL e CHECK erano ancora a 32.768 mentre client/gateway usavano 262.144. Alzati i soli limiti previsti dalla migrazione.
5. Helper temporaneo service-role-only per nuove identità fixture 02 e 03. Nessuna password/token esposta, nessun reset di credenziali esistenti.

Il tentativo reale 02 ha superato registrazione/chat/allegati/lista nascosta, ma ha rilevato il vecchio limite SQL durante la prima lettura a 256 KiB. È conservato separatamente; non è dichiarato passato.

## Prove realmente eseguite
- Suite locale JavaScript completa dopo l'ultima modifica: 492 PASS, 0 fail, 0 skip.
- Python/JVM: 23 PASS. Include compilazione ed esecuzione del vero catalogo Java con stub Android: file e cartella nascosti presenti, byte letti identici, symlink e cartelle protette esclusi. Non equivale a un dispositivo Android.
- Controllo sintassi JavaScript e git diff --check superati.
- E2E HTTPS reale run AUTH_E2E_NEW_FIXTURES_20261119_03: completeEndToEnd=true, dati in FreePT-unified-live-success-03-2026-11-19.json.
- Auth reale admin/utente fixture; registrazione anonima come nell'app, inserimento nome/telefono, blocco invio pending, approvazione sotto RLS e approvatore esatto.
- Messaggio utente e risposta amministratore, lettura di entrambi; upload/download di 1.024 byte e hash identico; rimozione del solo allegato sintetico, pulizia chat e cancellazione del solo utente sintetico creato dalla prova.
- Enrollment proprietario reale, grant all'approvatore nonostante amministratori multipli, connessione TX, browse e metadato .hidden-synthetic.bin.
- Trasferimento normale Bridge su HTTPS: 300.000 byte in 262.144 + 37.856, SHA256 40fa988e777cad6286d545979378a3809c980beb0557ed19fe8e9e072bc4901b.
- Trasferimento bootstrap separato: 300.000 byte, SHA256 e1c0a47181051622660a997336472f9f8b2f50263a5c7b3cd89405e80a122b50; replay, codice errato, corruzione, sostituzione token, claim idempotente e revoca controllati.
- Dispositivo normale sintetico rimosso; fixture bootstrap revocata; sessioni dei soli account test scollegate.

## Limiti e collaudo necessario sul telefono
L'E2E HTTPS usa un trasmettitore Node con contenuto sintetico, NON un telefono Android. Non sono stati eseguiti: avvio fisico OPPO, Android Keystore hardware, permanenza in background/ColorOS, notifica FCM effettiva, aggiornamento in-place e conservazione permessi fisicamente osservata. Il package e la firma stabili rendono possibile l'aggiornamento del TEST, ma non costituiscono una prova fisica di conservazione dati.

APK da consegnare solo dopo build Android reale, verifica firma, package it.freept.bridge.next, integrità e SHA256. Non sostituire la produzione it.freept.app e non consegnare l'artefatto della pipeline di produzione. La qualifica finale su OPPO resta subordinata al collaudo fisico; non dichiararla eseguita.

## APK effettivamente prodotta e verificata
- Commit sorgenti: `d4c24c359845c61dfab7479d656d02e648579a8e`.
- Run staging: https://github.com/studiosmus-source/FreePT/actions/runs/44613764141 — success.
- Artefatto APK: `FreePT-bridge-staging-stable-apk`, ID 14574196569; rapporto CI ID 14573987004.
- Nome consegna: FreePT-Unificata.apk, 4.976.065 byte; package it.freept.bridge.next, versione 1.0/code 1, minSdk 23, targetSdk 35. Il Bridge all-files richiede Android 11+; il minSdk generale della chat non equivale al supporto all-files su Android precedenti.
- SHA256 APK: `8d43d80a37e24cc0bd7987d74080b94a85f238eb8c1425ece036d79de3c1eef0`.
- SHA256 certificato: `7f9a7a4b77ec6fe9f87221cc5afd0ad6943e21c25b9ddde1e28ce0fedace06f6`.
- Verifiche locali sul file scaricato: integrità ZIP, firma APK v2 crittografica, digest dei contenuti APK, configurazione web isolata effettiva. SHA256 coincide con rapporto CI.
- Scaricato anche l'APK storico 185f90e (artefatto 14561792634): firma verificata e certificato identico alla nuova APK. Questo consente l'aggiornamento della medesima app TEST; mantenimento permessi/sessioni fisico resta NON ESEGUITO.
- Gateway finale deploy dep-dbvm52cipgvc73dkqqp0 da d4c24c3 LIVE. /health HTTP 200; /test/ e /test/server-e2e.json HTTP 404. Gate one-off e console DISABLED.
- L'upload persistente della copia APK è fallito per library_storage_limit_exceeded. Il binario è disponibile nel messaggio corrente e nell'artefatto GitHub sopra. Nessun file utente eliminato per liberare spazio.
