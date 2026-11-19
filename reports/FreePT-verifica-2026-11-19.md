# FreePT — rapporto aggiornato, 19 novembre 2026

**Stato: implementazione sperimentale in isolamento; APK definitiva NON completata e NON consegnata.** Il Chieditore e il protocollo pre-account ora esistono nel codice. La prova telefonica end-to-end con Keystore Android/servizio/HTTPS e i collaudi fisici restano da eseguire: nessuna build CI li sostituisce.

## Fonte e commit

Ramo: `work/unified-verified-20261119`.
HEAD effettivo verificato alla ripresa: `a37cbd39689d8fdeec6998b145b85c81d263670a`. Il rapporto precedente è conservato nella storia di quel commit.
Commit sorgenti e configurazione CI del presente rapporto: `9560b5bae861fa8f0437f2f5ac508397689d1303`.

| Commit | Contenuto |
|---|---|
| `51ccd599d0b9e327bba6a372b7018be156d45c1c` | Chieditore, protocollo ECDSA, handler isolato, schema e prime prove HTTP/PostgreSQL |
| `6ba38e23d52135ebb5ebd6f908c89784df5afb10` | Binding alla sessione personale, journal SAF, controlli provider e intent rapporto |
| `f763ffc80e5507922cc16ab043b0b280dd6ab64a` | Compatibilità JVM→Node, ripresa onboarding, cancellazione connessioni, protocollo Oppo |
| `db402946511a47c447a10bfcc533c55bec946bf0` | Cancellazione profili compatibile, regressioni sicurezza, assert esecuzione test nativi |
| `0cd7902b6945662f4dce27153714fc51655bad46` | Conservazione consenso SAF su outage, provider che restituisce documenti esistenti, path multilinea |
| `e2c1e86c52b4c6e7ebe8dab98bc6320d9cb4cb28` | Suite nativa estesa a cartelle condivise, collisioni e rename persona/directory |
| `9560b5bae861fa8f0437f2f5ac508397689d1303` | Copertura dei trigger CI per Chieditore, schema, test nativi e lockfile |

Confronto: https://github.com/studiosmus-source/FreePT/compare/a37cbd39689d8fdeec6998b145b85c81d263670a...9560b5bae861fa8f0437f2f5ac508397689d1303

## Implementazione e autorizzazioni

Il Chieditore precede il form nome/telefono nelle build isolate abilitate. Richiede/verifica una voce per volta usando il plugin File esistente e il controllo notifiche senza registrare token push. Rilegge i permessi dopo le Activity, conserva i consensi già presenti, marca ColorOS non interrogabile come «non verificabile». Un tentativo non verificato non apre la registrazione; chiudendolo viene fermato TX. Il rapporto JSON locale contiene solo modello/SDK, stati, tempi e codici ammessi e si condivide manualmente. Nessun invio automatico a AI.

Il dispositivo genera una chiave P-256 nel Keystore e una richiesta tecnica firmata, senza account personale. Solo l'admin Supabase approved, riconoscendo il dispositivo e inserendo il suo codice casuale, può autorizzarla. Nessuna associazione automatica a un admin. Il server verifica la firma esatta di azione, dispositivo, timestamp, nonce e payload; SQL blocca la riga e consuma atomicamente il nonce. Il codice è monouso, memorizzato come hash e scade dopo 15 minuti.

Lo stesso servizio nativo TX ha una corsia pre-account limitata ai dati sintetici: riceve un job diagnostico autorizzato e trasferisce 300.000 byte in due chunk, con confronto byte per byte lato server e SHA256 su entrambi i lati. Non accetta handle o percorsi personali. La sola Activity riuscita, il permesso o `BridgeTxService.active` non attestano successo: servono completamento server, hash corrispondente, servizio e permesso attivi.

Solo dopo questa verifica si può passare al form personale. Dopo l'approvazione personale, claim richiede la stessa chiave e la sessione Supabase approved; la firma include l'hash del token personale contro lo scambio di account. Una transazione crea dispositivo/verifier/grant legacy verso l'esatto admin autorizzante. Nessuna promozione nello stato personale pending. Retry dopo perdita dell'ack riusa il segreto già cifrato nativamente; JS non riceve il segreto. Revoca, scadenza, admin bloccato e owner diverso negano le operazioni. La cancellazione di un profilo non viene bloccata dai nuovi riferimenti.

Dettagli, wire format e gate: [BOOTSTRAP_PRE_ACCOUNT_V1.md](../docs/BOOTSTRAP_PRE_ACCOUNT_V1.md).

## SAF condivisa per persona

Conservato il gestore unico già presente e il trasporto condiviso chat admin/Bridge per owner ID. Aggiunti:

- creazione sicura che rifiuta documenti preesistenti restituiti dal provider, nomi alterati e collisioni senza scrivere sopra file estranei;
- journal persistente dello staging, recupero conservativo dopo ricreazione del plugin e rollback sul solo documento posseduto;
- protezione del picker durante trasferimenti, serializzazione e controlli di path anche con caratteri di controllo multipli;
- conservazione dell'URI/consenso persistente su indisponibilità temporanea del provider, senza nuovo picker automatico;
- prove native simulate di file >256 KiB, omonimi, cambio nome profilo/directory, stessa persona tra chat e cartelle Bridge, struttura annidata, collisioni, revoca, provider anomalo e trasferimenti sovrapposti.

Il journal e il rename SAF non sono una transazione unica universale: un crash nella finestra tra rename provider e aggiornamento preferenze rimane un limite da collaudare. Nessuna promessa di atomicità/assenza di overwrite per provider arbitrari senza prova e politica di supporto.

## Verifiche e risultati

| Livello | Esito | Prova e limite |
|---|---|---|
| Sorgenti/HEAD e chiamanti | Eseguito | Client, server, native, permessi, persistenza, schema, installatore e workflow; confronto dalla base effettiva |
| Statico | PASS | `node --check src/main.js`, controlli sintassi moduli nuovi, compilazione Python e `git diff --check` |
| JavaScript locale/CI | 447 PASS, 0 fail, 0 skip | Suite `bridge/*.test.mjs src/*.test.mjs supabase/*.test.mjs`; include controller e contratto/prove crittografiche, non 447 prove Android |
| Python/JVM | 22 PASS | Include policy nomi Java, generazione firma Java P-256 verificata da Node e fixture/hash identici, più rifiuto del gate bootstrap sul target production |
| HTTP + PostgreSQL CI | PASS, 2 test | Gateway HTTP reale su loopback, ECDSA reale e transazioni PostgreSQL reali. API Supabase Auth sostituita da fixture: non è una prova Auth live. Byte corrotti, replay, approvazione errata, account scambiato, pending, expiry, revoca admin/dispositivo e cancellazione profilo verificati |
| Native SAF simulato | PASS, 11 test, 0 error/failure/skip | Plugin Java reale sotto Robolectric (SDK 28) con trasporto/provider SAF simulati. Workflow richiede almeno 11 test effettivamente eseguiti, zero failure/error/skip; non un test fisico/provider reale |
| Android unificata + firma stabile | PASS | Compilazione, package/certificato e integrità; bootstrap DISABILITATO nella build produzione, APK esclusa dagli artefatti consegnabili |
| Android isolata | PASS | Bootstrap abilitato per compilazione/test; endpoint `.invalid`, nessuna APK operativa pubblicata |
| Build web locale | PASS | Vite; nessun contatto con produzione implicito |
| Supabase test reale | PASS per schema/ACL/RPC SQL | Schema installato, ACL/RLS lette realmente, prova SQL come service_role con rollback; non un telefono collegato al gateway HTTPS |
| Oppo/Android reale/Keystore hardware | NON ESEGUITO | Nessun telefono/emulatore operativo disponibile |
| Regressione chat reale e upgrade in-place | NON ESEGUITO | Codice e test automatici preservati; UI/push/sessioni/permessi dopo installazione vanno collaudati |
| Prestazioni 10× | NON DIMOSTRATO | Nessuna misura omogenea eseguita |

### Pipeline

- Unificata/firma, commit `9560b5b…`: https://github.com/studiosmus-source/FreePT/actions/runs/44481137229
- JavaScript/PostgreSQL, stesso commit: https://github.com/studiosmus-source/FreePT/actions/runs/44481137277
- Isolata e 11 test nativi, commit `e2c1e86…`: https://github.com/studiosmus-source/FreePT/actions/runs/44481037352

Tra `e2c1e86…` e `9560b5b…` cambiano solo trigger di workflow: sorgenti Android/app, test e dipendenze della build isolata sono identici. Il link isolato è riferito esplicitamente al commit eseguito.

Le prime due compilazioni Android sono fallite e sono state corrette: conversione `Intent.setClipData` (metodo void) e gestione checked `JSONException` nel rapporto. Run storiche Android: `44478095477` su `51ccd59…`, `44479156264` su `6ba38e2…`. Nessun errore è stato ignorato per pubblicare APK.

## Supabase: ambiente modificato e prove effettive

**Produzione `cpopqsvzzxfjgnlawlvc`: nessuna scrittura, migrazione, deploy, modifica dati/ruoli/chiavi o Edge Functions. Nessuna modifica Render o email/push.**

Solo `FreePT-Bridge-Test`, ref `aqjuixbuxftnjfzxmzuj`:

| Migrazione applicata | Versione |
|---|---|
| `bridge_bootstrap_device_key_v1` | `20261119072047` |
| `bridge_bootstrap_profile_cascade` | `20261119073139` |

Due nuove tabelle con RLS attiva e nessun accesso diretto anon/authenticated; funzione SECURITY INVOKER, search_path vuoto, EXECUTE solo service_role. Permessi service_role sulle tabelle legacy verificati prima dell'installazione, senza modificarli. Verificati realmente: `anon_execute=false`, `service_execute=true`, `anon_select=false`, `authenticated_insert=false`; entrambe le FK profilo `ON DELETE CASCADE`.

Smoke SQL con ruolo service_role: pending senza profilo personale, replay rifiutato, nessun job prima di autorizzazione, rollback finale. La prima esecuzione smoke ha rilevato un nome variabile SQL ambiguo; corretta e rieseguita con successo. Conteggi finali delle nuove tabelle: **0 dispositivi, 0 nonce**. Nessun account Auth reale o dato personale di prova creato da questi smoke. Lo smoke SQL testa il livello privilegiato, non sostituisce la verifica ECDSA del gateway.

Linter dopo installazione: le due nuove tabelle producono solo l'avviso informativo RLS senza policy, intenzionale perché riservate al gateway. I warning preesistenti relativi a funzioni legacy/Auth non sono stati modificati collateralmente. Riferimento linter: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Script e hash del payload finale:

- `supabase/bootstrap/INSTALL_STAGING_ONLY.sql`: `6a4e04d6cf98be256eff246027e5c1661fcbabccfdc057e10194c4e570787131`.
- `supabase/bootstrap/UPGRADE_PROFILE_CASCADE_STAGING_ONLY.sql`: `e268faa4279ef3e86d6015083f632093ffa3fe9794eab40b3f1d1d118ea3b777`.

L'installazione iniziale più l'upgrade producono lo schema dell'INSTALL finale. Non eseguire questi script automaticamente su produzione.

## Preservazione delle funzioni esistenti

Restano «Copia» solo admin, assenza di condivisione testo/file, login Supabase senza impronta e destinazione per persona già implementati. Nessuna doppia implementazione di firma/fixture Java: `BridgeBootstrapProof` è usata dal servizio e dalla prova JVM.

File identici byte per byte rispetto a `a37cbd3…`:

| File | SHA256 |
|---|---|
| `src/chatAttachmentsUi.js` | `c411ff2d269cce755bf537d6a2c43126947ce622cff8caa5268319a4f1b7dd0b` |
| `src/chatAttachments.js` | `fd8c0834c9ad57f4c67344743939c28914cfde359f087a04efd70a1fb8e97827` |
| `src/pushRegistration.js` | `60b8280cb0ee6727f124701ecc317826e07b747837b56d3a8907e20460f0cfc1` |
| `src/style.css` | `ff6f71001acd0307ce5bd8770c966f238f4ffab67d6a5ec4bd7fe49cb262bc49` |

La nuova logica tocca onboarding e binding prima dell'ingresso in workspace; il gestore nativo SAF condiviso è stato modificato e richiede regressione fisica anche per gli utenti esistenti. Identità dei file non equivale a prova funzionale o visuale della chat.

## Blocchi residui e criterio di consegna

1. **Gateway HTTPS di staging non distribuito/configurato per il telefono.** Il codice è cablato nella composizione HTTPS staging dietro gate esplicito; nessuna modifica alla composizione produzione. Su Render non è disponibile un workspace selezionato e non ne è stato scelto uno arbitrariamente. CI usa rete loopback/database effimeri e la build isolata un host `.invalid`.
2. **Manca prova Android nativo → gateway HTTPS con Auth live e Keystore hardware**, inclusi autorizzazione admin fisica, trasferimento sintetico prima di nome/telefono, report manuale e successivo binding. È un blocco per l'accettazione, non un PASS dedotto dai test.
3. **Mancano i collaudi Oppo/ColorOS**, installazione/aggiornamento in-place, sessioni e permessi persistenti, SAF reale/provider, crash nei punti critici e regressione chat/push reali. Protocollo pronto: [COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md](../docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md), casi P01–P17 e S01–S13 con azioni/esiti obbligatori.
4. **Esposizione pubblica da validare:** TLS/proxy fidato, controllo abusi/capacità, chiavi server, monitoraggio/revoche e backup/rollback verificati. Il codice non introduce un accesso remoto pubblico anonimo: start crea solo pending, le altre capacità richiedono prova del dispositivo e autorizzazione.
5. La build unificata definitiva non ha il bootstrap attivato su produzione; un'attivazione richiede revisione dell'impatto e approvazione dell'utente. Non pubblicare un'APK vecchia o la build isolata come prodotto completo.

## Artefatti e rollback

Nessun merge e nessuna pubblicazione APK. La pipeline unificata conserva solo evidenze (test, identità e hash), la pipeline isolata conserva report nativi. Le build signed/debug in CI non attestano installazione sul telefono.

Rollback del ramo: non unire le modifiche. Rollback staging: disabilitare il gate del nuovo handler; dopo revoca delle eventuali grant promosse, rimuovere soltanto funzione e nuove tabelle, conservando il resto del Bridge. Non presumere che eliminare le tabelle bootstrap revochi grant legacy già promosse. Attualmente gli smoke staging hanno lasciato le nuove tabelle vuote e non hanno promosso dispositivi reali.


### Evidenze finali conservate

- Evidenze unificata (nessuna APK): https://github.com/studiosmus-source/FreePT/actions/runs/44481137229/artifacts/14508292361
- Report HTML/XML dei 11 test nativi simulati: https://github.com/studiosmus-source/FreePT/actions/runs/44481037352/artifacts/14507394991
- Riepilogo macchina: [FreePT-evidenze-2026-11-19.json](FreePT-evidenze-2026-11-19.json).
- Protocollo dispositivo: [COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md](../docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md).

SHA256 del candidato unificato calcolato da GitHub Actions: `2c4846c2ddb46743af51ed58d1bd21dc831d12c27b40b52c105e17421c72a9d1`. Firma stabile verificata dalla pipeline con `apksigner` e confronto col certificato atteso. Il candidato non è stato pubblicato/scaricato e l'hash non è stato ricalcolato localmente. Package unificata `it.freept.app`; la build conserva il formato debug firmato del workflow esistente. Questo identificatore non certifica il Chieditore in produzione né l'installazione su Oppo.


## Ripresa successiva — verifica infrastruttura e decisione pendente

Verificato nuovamente HEAD remoto/locale `1894ec07d379ff41bc62a00eae8732ff07d30194`, sorgenti gateway, blueprint e workflow. Supabase test confermato sano; nuova lettura ACL/RLS e conteggi bootstrap: nessuna esposizione anon, entrambe le tabelle vuote. Nessuna modifica applicativa o infrastrutturale in questa ripresa; nessun nuovo test end-to-end o build dichiarati.

Render non ha workspace selezionato. L'unico workspace elencato è **My Workspace** (`tea-daslui3ncjis73anu1v0`, account `studiosmus@gmail.com`); serve conferma dell'utente prima di individuare/usare il servizio test in quel workspace. L'health URL storico nei sorgenti è andato in timeout a 20 secondi, senza risposta HTTP: non è prova di servizio assente o guasto.

Il blueprint/workflow staging storico punta a un vecchio ramo e il workflow aggiunge ancora un permesso biometrico: va consolidato prima di costruire la nuova APK sperimentale. I valori correnti dei secret GitHub/Render non sono stati letti o verificati. Produzione invariata; nessuna APK sperimentale non configurata è stata pubblicata.

Punto di ripresa operativo completo: [FreePT-PUNTO-RIPRESA-HTTPS-2026-11-19.md](FreePT-PUNTO-RIPRESA-HTTPS-2026-11-19.md).


## Workspace confermato — servizio test identificato, autenticazione pannello pendente

Conferma utente ricevuta per My Workspace; servizio test reale identificato: `freept-bridge-staging`, ID `srv-dbo9t6lg1s2s73ejjtn0`, piano free, auto-deploy off, repo FreePT e ramo storico `feature/bridge-chunk-receiver-20261108`. Deploy live osservato `37eb2df491241581019c74d62019cea0fcd3bf44`; nuova richiesta `/health` riuscita con HTTP 200. Produzione/TX/OTA identificati separatamente e non modificati.

Per cambiare il ramo occorre il pannello Render, poiché il connettore non espone tale impostazione. Il browser richiede login; nel flusso scelto dall'utente Google ha segnalato che la password era stata cambiata 5 mesi prima. Non sono stati eseguiti retry automatici né letti segreti. Autenticazione manuale protetta pendente.

Nessun deploy o modifica infrastrutturale eseguiti; nessuna nuova APK o prova end-to-end attestata. Il [punto di ripresa](FreePT-PUNTO-RIPRESA-HTTPS-2026-11-19.md) contiene servizio, stato, limiti e azioni successive; non richiedere di nuovo la scelta del workspace già confermata.

## Ripresa HTTPS: 19 novembre 2026, 09:37 CET

Partenza verificata: HEAD locale/remoto `ec66b84a8cf1de41b316cc041123758b7436505d`; letto integralmente il punto di ripresa HTTPS. Nessuna implementazione app aggiunta o sostituita: preservati chat, push, Copia amministratore, accesso senza impronta e SAF per persona.

### Modifiche effettive sul solo test

Accesso Render riuscito, osservato nel browser. Servizio `srv-dbo9t6lg1s2s73ejjtn0` nel workspace già confermato `tea-daslui3ncjis73anu1v0`:

- Ramo impostato a `work/unified-verified-20261119`, piano free, autoDeploy no/trigger off.
- Health path impostato `/health`.
- Osservate le chiavi, senza rivelare segreti. Valori non riservati verificati: progetto `https://aqjuixbuxftnjfzxmzuj.supabase.co`, origine `https://localhost`, gate staging/public/read corretti.
- Aggiunto con merge solo `FREEPT_BRIDGE_BOOTSTRAP=STAGING_DEVICE_KEY_V1`. Credenziali esistenti non lette, ruotate, sostituite o esportate.
- La chiamata API di aggiornamento ambiente ha avviato essa stessa il deploy, pur con autoDeploy off. Non lanciato un secondo deploy manuale. Deploy `dep-dbvb9nc9v7es73989ccg`, sorgente `ec66b84…`, **live** alle 08:36:06 UTC, confermato da API e browser.
- `render.yaml` allineato alla configurazione osservata; Dashboard/API resta la configurazione effettiva. Nessuna creazione o sincronizzazione Blueprint eseguita.
- Nessuna mutazione dei servizi produzione/TX/OTA, del progetto Supabase produzione, di account personali o credenziali.

### Prove nuove realmente eseguite

`reports/FreePT-live-HTTPS-2026-11-19.json` registra **12 controlli live PASS** su HTTPS Render → RPC del Supabase test. Client Node P-256 reale, non Android Keystore:
health; approvazione anonima negata; token Auth invalido negato; origine estranea negata; firma alterata negata; envelope scaduto negato; start firmato pending con origine Android; replay persistente negato; nessun job prima dell'approvazione; claim senza login negato; cancel firmato; dispositivo cancellato inaccessibile.

Creato esclusivamente dispositivo sintetico `b8079bdc-20a0-4ad0-aa1d-8395d1493c49`, annullato tramite propria firma. Query Supabase successiva: 4 utenti Auth invariati; 1 admin approved, 3 user approved; 1 bootstrap senza admin/owner, received=0, revoked_at valorizzato; 0 bridge_devices per questo ID. Nessun profilo personale creato. La riga tecnica annullata resta come prova e può scadere secondo la normale gestione bootstrap.

Controllo sintattico del nuovo script PASS. Nuova esecuzione mirata: **11/11 test automatici PASS**, 0 skip/fail, su bootstrapProtocol, bootstrapHandler, httpsGateway. I risultati storici 447/22/2/11 restano quelli documentati in precedenza: non sono stati ripetuti né trasformati in prove fisiche.

Aggiunto workflow `bridge-https-live-staging.yml`: verifica HTTPS riproducibile, crea/annulla solo un dispositivo sintetico per esecuzione, pubblica il JSON dei risultati. Non richiede né pubblica token/secret. Non certifica l'approvazione con login valido o l'end-to-end completo.

### Blocco reale e criteri APK

Manca una sessione **Supabase Auth reale dell'amministratore test** e, per il claim, un'identità personale di prova autorizzata. L'accesso Render non fornisce tali sessioni. Non sono stati creati JWT falsi, usati service_role come login, modificati ruoli, resettate password o utilizzati utenti reali per aggirare il blocco.

**NON ESEGUITI live**: approvazione con admin autentico, codice errato sotto sessione admin valida, trasferimento sintetico 300000 byte dopo approvazione, verifica hash e replay chunk, associazione a sessione personale approvata, revoca/scadenza del grant approvato. Questi casi sono coperti storicamente dall'integrazione HTTP/Postgres con Auth simulata, che non sostituisce Auth reale.

**NON ESEGUITI fisicamente**: Android Keystore hardware, Oppo/ColorOS, permessi/servizio in background, aggiornamento APK e conservazione SAF/sessione. Protocollo: `docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md`.

Nessuna APK nuova prodotta/consegnata: la pipeline sperimentale storica richiede ancora consolidamento (ramo vecchio e biometria residua). La sicurezza live completa e i controlli package/firma/Firebase/configurazione staging restano prerequisiti. Non sostituire l'APK di produzione.

### Conferma GitHub Actions della nuova prova live

Commit script/configurazione/rapporto: `9ec95ce314d3a20dbf5f990efebf0140e9b14d17`.
Run https://github.com/studiosmus-source/FreePT/actions/runs/44489499174 conclusa **success**; job `135441225368`, log letto realmente, 12 controlli live PASS anche dal runner GitHub. Report CI estratto dal JSON effettivo nel log: `reports/FreePT-live-HTTPS-CI-2026-11-19.json`. Dispositivo sintetico CI `3c7acb06-ee45-457a-867a-e68a9dc743ac`, creato e cancellato mediante protocollo. Questa seconda esecuzione non è una prova Android né Auth E2E completo.
Artefatto https://github.com/studiosmus-source/FreePT/actions/runs/44489499174/artifacts/14511459399, digest ZIP GitHub `ffcb858f9036bee5f0518b6f1ffdc9ce5d45921ce23af086b100a4f9a5147f6f`.
Il gateway rimane sul deploy ec66b84; i commit successivi aggiornano solamente script, configurazione dichiarativa, workflow e rapporti, senza modificare codice runtime app/backend.

## Ripresa c116077 — preparazione accesso Supabase TEST

HEAD iniziale locale/remoto confermato `c11607772d39fec0b66cb44bca3e6d18c993bd99`; punto di ripresa letto integralmente. Non ripetuti i 12 controlli HTTPS già superati. Nessuna credenziale o ruolo cambiato, nessun utente reale modificato.

Preparata console temporanea `/test/` sul solo gateway staging, attiva esclusivamente con `FREEPT_BRIDGE_TEST_CONSOLE=AUTH_E2E_ONLY`, bootstrap v1 e progetto esatto aqjuixbuxftnjfzxmzuj. La composizione produzione non installa la console. CSP senza script inline/CDN, frame vietati, HTTPS obbligatorio, no-store; configurazione pubblica contiene solo URL test e publishable key. Credenziali inviate dal browser direttamente a Supabase TEST; token conservati nella sola closure in memoria, mai in storage, URL, log o rapporti. Nessuna raccolta di password/token tramite strumenti o chat.

Due login normali (admin TEST e user TEST), verifica Auth `/user` e profilo via RLS, nessuna creazione/modifica profili. Il pulsante E2E richiede conferma che siano account di prova: genera chiave WebCrypto e fixture, approva tramite bearer admin, prova codice errato/ACL/replay, invia 262144+37856 byte, confronta SHA256, claim legato al token personale, verifica retry e stato bound, revoca il dispositivo. In caso di errore tenta cancel/revoke della sola fixture. Non certifica Android Keystore o Oppo.

Nuovi test: conversione firme WebCrypto P1363→DER verificata 64 volte con verifica crittografica Node; byte fixture browser confrontati con server; isolamento progetto/gate e routing HTTPS/CSP provati. 11/11 test mirati PASS. Suite completa JavaScript in corso al momento di questa nota (registrare risultato effettivo prima della consegna).

Prossima azione: distribuire la console esclusivamente su srv-dbo9t6lg1s2s73ejjtn0 dopo verifiche, aprire il suo login e acquisire le sessioni mediante procedura browser sicura o handoff. Non chiedere password/token in chat. Prima di un handoff salvare commit/deploy/URL e stato preciso. E2E autenticato e APK restano NON ESEGUITI finché non conclusi realmente; consolidamento workflow Android da eseguire dopo E2E riuscito.

### Verifica automatica prima del deploy console

Suite JavaScript completa effettivamente eseguita: **451 test, 451 PASS, 0 fail, 0 skip**. Prima esecuzione 450 PASS/1 FAIL: controllo blueprint obsoleto sul comando letterale; corretto per verificare `npm run bridge:serve:staging` e la sua risoluzione effettiva a `node bridge/runHttpsStaging.mjs`, più il ramo work. Nessun errore occultato. I 12 probe HTTPS precedenti non sono stati ripetuti.

## PUNTO DI RIPRESA ATTUALE — console TEST pubblicata, accesso da completare

Commit implementazione console: `bfd9aad8045a29bd05dcdd948419acc21093c75c` (partenza c116077). Servizio staging `srv-dbo9t6lg1s2s73ejjtn0`, workspace confermato `tea-daslui3ncjis73anu1v0`. Aggiunto via merge soltanto `FREEPT_BRIDGE_TEST_CONSOLE=AUTH_E2E_ONLY`; nessuna credenziale letta/modificata. L'API ambiente ha avviato il deploy `dep-dbvbji59el5s73dtc36g`, **live** dal 19 novembre 08:57:17 UTC, commit bfd9aad. Piano free/ramo work/auto-deploy off preservati. Nessun deploy di altri servizi o produzione.

Pagina verificata da HTTP e browser: **https://freept-bridge-staging.onrender.com/test/**, HTTP 200, CSP/no-store/frame DENY effettivi. Statici disponibili esclusivamente sulla composizione staging, gate esplicito e progetto test esatto. L'origine staging della console viene aggiunta in memoria alla allowlist solo quando il gate console è attivo; i controlli Auth, firme e ACL restano invariati. Chiudere la console dopo i collaudi impostando il gate a DISABLED sul solo staging (merge), senza toccare altre variabili. Questo disabilita anche l'origine della console; `https://localhost` Android rimane.

### Accesso sicuro tentato realmente

Browser cloud Chrome ID 1, scheda **3**, pagina sopra. Variabili runtime: `browser`, `authTab`, `testAuth`. Un solo tentativo tramite `browserAuth.request` per i campi del form admin. Il modulo protetto ha restituito `submitted`, ma la successiva osservazione della pagina ha mostrato **“Login non riuscito. Verificare le credenziali TEST senza inserirle in chat.”**. Quindi **nessuna sessione amministratore verificata**. Non è nota la causa specifica del rifiuto; non affermare automaticamente password errata o account assente. Nessun retry automatico, cambio password/ruolo o lettura token. Segnalato il blocco browser tramite capability dedicata. Necessario handoff alla stessa scheda per completare l'accesso con account applicativi TEST, non account Render/pannello Supabase. Non chiedere segreti in chat.

Alla ripresa osservare subito lo stato DOM della scheda 3. **Non ricaricare/navigare se l'utente ha concluso il login: le sessioni sono solo in memoria.** Un popup chiuso o `submitted` non prova successo: serve lo stato “Autenticato TEST: ruolo e stato approvato verificati.”. Occorrono entrambi i form admin e user TEST. Non esaminare valori password, sessioni JS, cookie, storage o richieste contenenti bearer. Non tentare di esportare token alla shell. L'utente deve identificare gli account TEST autorizzati; non assumere sacrificabili profili reali.

Dopo entrambi i login validi, la conferma account TEST abilita “Esegui end-to-end sintetico”. Eseguire dalla UI autorizzata, leggere il JSON visibile nel riquadro risultati (solo dati di prova, nessun token), conservarlo nel rapporto e verificare `completeEndToEnd: true`, bytes=300000, sha256, claim/revoca. Verificare inoltre in sola lettura DB test il grant al preciso admin e owner personale della fixture (non stampare email/contatti). In caso di fallimento descrivere il singolo controllo, non dichiarare successo complessivo. Non simulare l'approvazione con SQL privilegiato.

### Nuove verifiche realmente completate

- JavaScript locale completo: **451/451 PASS, 0 fail/skip**, output in `reports/FreePT-console-automatic-tests-2026-11-19.txt`. Primo giro 450/451: test blueprint obsoleto; consolidato controllando comando npm e suo script effettivo. Secondo giro tutto PASS.
- Python/JVM locale: **22 test PASS**, output `reports/FreePT-console-python-tests-2026-11-19.txt`.
- GitHub backend/web/PostgreSQL: **success** https://github.com/studiosmus-source/FreePT/actions/runs/44491909944 ; tutti i quattro job conclusi. HTTP/Postgres ha Auth fixture, non sostituisce Auth live.
- Android isolata compile + SAF Robolectric: **success** https://github.com/studiosmus-source/FreePT/actions/runs/44491910013 . Log letto: BUILD SUCCESSFUL; suite BridgeDestinationTest **11 test, 0 skipped/failures/errors**. Report https://github.com/studiosmus-source/FreePT/actions/runs/44491910013/artifacts/14513052099 . Questa build usa endpoint `.invalid`, non è APK operativa.
- Pipeline unificata: **success** https://github.com/studiosmus-source/FreePT/actions/runs/44491910075 ; esito job verificato. Non è nuova APK sperimentale accettata e non va consegnata come FreePT TEST.
- I 12 controlli HTTPS precedenti non ripetuti.

**Ancora NON ESEGUITI:** E2E con admin Supabase valido, trasferimento live autorizzato, hash/claim live, telefono Oppo/Keystore hardware/SAF e aggiornamento in-place fisico. Nessuna nuova APK operativa pubblicata. Workflow Android staging storico ancora da consolidare soltanto dopo E2E riuscito come richiesto. Non modificare chat/push, Copia amministratore, accesso senza impronta o cartelle SAF per persona.

## Autorizzazione nuovi account TEST — 19 novembre 2026

L'utente ha dichiarato di non ricordare le credenziali e ha autorizzato esplicitamente due nuovi account di collaudo (admin e personale), senza modificare account esistenti o produzione. Il suo accesso personale non viene reimpostato.

Preparato runner una tantum backend `bridge/stagingAuthE2E.mjs`, nessuna route HTTP di provisioning. Gate esatto `FREEPT_BRIDGE_AUTH_E2E=AUTH_E2E_NEW_FIXTURES_20261119_01`, solo progetto aqjuixbuxftnjfzxmzuj e console/Bootstrap staging espliciti. Usa il service credential già presente in Render soltanto nel processo, API ufficiale Auth Admin createUser per identità nuove con email fixture fisse, password casuali mai esportate e normale signInWithPassword/getUser. Un conflitto di account preesistente interrompe tutto: nessun reset/upsert/fallback. Provisiona solo il nuovo profilo admin autorizzato e, dopo la diagnostica, un nuovo profilo user pending; la sua approvazione usa la vera sessione admin e RLS, non UPDATE privilegiati per simulare approvazioni. Tutte le operazioni bootstrap passano dal gateway HTTPS reale con firme/nonce, trasferimento 300000 byte/hash/claim/revoca e conferma DB del grant esatto. Sessioni di prova invalidate a fine corsa; account fixture e dispositivo revocato conservati come evidenza, senza cancellazioni o cambi su utenti esistenti.

Il runner pubblica soltanto un JSON di esito senza credenziali su `/test/server-e2e.json` quando il gate è abilitato. Nessuna chiamata pubblica può avviarlo o creare utenti. Disabilitare subito il gate dopo la prova; non rieseguire con email diverse senza verificare e registrare la necessità. Pass test automatici da riportare dopo esecuzione; E2E reale non ancora dichiarato riuscito prima della distribuzione/esito.

Runner nuovi account: suite completa JavaScript **455/455 PASS**, 0 fail/skip; output `reports/FreePT-auth-fixtures-tests-2026-11-19.txt`.
