# FreePT — punto di ripresa Android → HTTPS test

## Stato della nuova verifica

Ramo richiesto: `work/unified-verified-20261119`.
HEAD remoto e locale letto realmente all'inizio di questa ripresa: `1894ec07d379ff41bc62a00eae8732ff07d30194`.
Letto integralmente `reports/FreePT-verifica-2026-11-19.md`, poi esaminati composizione gateway staging, validatori, blueprint Render, workflow staging/unificata, confini Supabase e installatore Firebase.

In questa ripresa nessun codice app/backend modificato, nessun deploy, migrazione, cambiamento di produzione o nuova APK. I risultati 447/22/2/11 del rapporto precedente restano prove della revisione già eseguita: non sono test nuovi di questa ripresa e non certificano Auth live o Keystore Android reale.

## Risultati nuovi, effettivamente letti

- GitHub conferma il ramo e HEAD `1894ec0…`.
- Supabase `FreePT-Bridge-Test` (`aqjuixbuxftnjfzxmzuj`) è ACTIVE_HEALTHY.
- Nuova query solo lettura: 0 righe bootstrap devices/nonces; RLS attiva su entrambe le tabelle; anon SELECT negato, anon EXECUTE negato, service_role EXECUTE consentito.
- Render: nessun workspace selezionato. Elenco workspace restituito: **My Workspace**, ID `tea-daslui3ncjis73anu1v0`, account `studiosmus@gmail.com`.
- Non è stato selezionato arbitrariamente il workspace e non sono stati elencati/modificati servizi in un workspace non confermato. Serve conferma dell'utente, anche se il workspace disponibile è uno solo.
- L'URL trovato nei sorgenti `https://freept-bridge-staging.onrender.com/health` ha prodotto timeout dopo 20 secondi, senza risposta HTTP. Non prova assenza del servizio: cold start/rete/stato effettivo sono ancora da verificare dopo l'identificazione del servizio.

## Configurazione osservata e incongruenze da correggere prima dell'APK

1. `render.yaml` punta ancora a `feature/bridge-chunk-receiver-20261108`, con auto-deploy disabilitato e piano dichiarato free. Non prova che questo blueprint rappresenti la configurazione del servizio realmente distribuito. Non include ancora il gate bootstrap v1.
2. Il workflow `bridge-android-staging.yml` ammette solo quel vecchio ramo, contiene endpoint staging fisso e un passo residuo che aggiunge USE_BIOMETRIC. Non usarlo così com'è per la nuova APK sperimentale.
3. `bridge-android-smoke.yml` compila il nuovo bootstrap, ma usa `.invalid` e non pubblica APK operative. Non consegnare quella build come collegata al gateway.
4. La pipeline unificata usa package produzione e gate bootstrap disabilitato: non sostituirla o pubblicarla al posto della sperimentale.
5. Il client isolato rifiuta il fallback a Supabase produzione; mantenere tale controllo. Il validatore backend staging rifiuta anch'esso il progetto produzione.
6. I workflow leggono le variabili/secret GitHub di staging e firma. In questa ripresa sono stati verificati i riferimenti nel codice, non letti o attestati i valori correnti dei secret. Non esportarli nel rapporto o nel repository.
7. L'installatore Firebase dedicato alla produzione rifiuta package diversi da `it.freept.app`; per la sperimentale occorre verificare la configurazione Firebase esatta del package staging con l'implementazione appropriata, senza allargare silenziosamente l'installatore produzione.

## Decisione infrastrutturale pendente

Chiedere all'utente di confermare **My Workspace** come workspace Render da utilizzare per il solo ambiente di test. Non è ancora approvazione di un piano a pagamento né di modifiche a un servizio produzione.

Dopo conferma:

1. Elencare i servizi con `workspaceId=tea-daslui3ncjis73anu1v0`; identificare il servizio test reale tramite dettagli, repository, ramo, comando, ambiente e hostname. Non dedurne l'identità dal solo nome e non riutilizzare un relay/servizio produzione.
2. Leggere stato/deploy/configurazione disponibili. Preparare la proposta concreta: servizio staging già esistente o nuovo servizio separato, costo/piano, branch/commit, gate, URL, TLS/proxy, origini e riferimenti ai soli secret test. Se emerge un'ulteriore scelta/autorizzazione infrastrutturale, presentarla prima della mutazione.
3. Verificare credenziali backend del SOLO progetto test senza mostrarle o inserirle nell'APK. Non creare JWT falsi, non usare service_role come account admin e non alterare ruoli per eludere il login. Usare account admin/personale di prova legittimamente autorizzati con Supabase Auth reale.
4. Distribuire solo dopo la decisione necessaria e controllare health, TLS, route bootstrap, proof ECDSA e ACL con un client di prova. Ripetere replay, codice errato, revoca/scadenza, trasferimento sintetico 300000 byte e claim legato alla sessione personale. Distinguere un client Java/JVM da un servizio Android realmente eseguito.
5. Preparare un workflow sperimentale sul ramo richiesto, configurato per l'endpoint test verificato, package staging separato `it.freept.bridge.next` e nome visibile inequivocabile (es. FreePT TEST). Verificare Firebase/package, firma stabile, manifest, endpoint/progetto realmente inclusi nell'APK, assenza di segreti e assenza di fallback produzione. Nessun nuovo pulsante di condivisione admin, impronta o cambiamento alla chat/push produzione.
6. Produrre l'APK sperimentale solo dopo i controlli; non sovrascrivere artefatti o package produzione. Allegare commit, run, artefatto, hash e limiti, senza chiamarla definitiva.
7. Eseguire le prove Android/Keystore su un ambiente Android realmente disponibile. Se il telefono fisico Oppo non è accessibile, lasciare i casi fisici NON ESEGUITI e usare `docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md` per la prova sul dispositivo.
8. Aggiornare il rapporto principale con prove nuove e blocchi residui. Conservare i link delle prove precedenti come storici, non sostitutivi dell'end-to-end richiesto.

## Riferimenti di partenza

- Repository: https://github.com/studiosmus-source/FreePT
- Rapporto letto: https://github.com/studiosmus-source/FreePT/blob/1894ec07d379ff41bc62a00eae8732ff07d30194/reports/FreePT-verifica-2026-11-19.md
- Protocollo: `docs/BOOTSTRAP_PRE_ACCOUNT_V1.md`
- Collaudo: `docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md`
- Ultime prove storiche: Actions `44481137229`, `44481137277`, `44481037352`, con i limiti descritti nel rapporto.


## Aggiornamento dopo conferma del workspace

L'utente ha confermato My Workspace. Non chiedere nuovamente questa conferma.

HEAD verificato all'inizio di questa fase: `f6ee1c695235d57e1ca310d274a9a9fc857627a0`.

Servizio di test identificato da API Render:

- Nome: `freept-bridge-staging`.
- ID: `srv-dbo9t6lg1s2s73ejjtn0`.
- Workspace confermato: `tea-daslui3ncjis73anu1v0`.
- Repository: `https://github.com/studiosmus-source/FreePT`.
- Ramo attualmente configurato: `feature/bridge-chunk-receiver-20261108`.
- Comandi: `npm install --omit=dev`, `npm run bridge:serve:staging`.
- Piano servizio: `free`, regione Frankfurt, autoDeploy `no`/trigger `off`, healthCheckPath configurato vuoto.
- Deploy live osservato: `dep-dboq67bl550s73aiaiog`, commit `37eb2df491241581019c74d62019cea0fcd3bf44`.
- URL: `https://freept-bridge-staging.onrender.com`.
- Nuova richiesta HTTPS `/health`: HTTP **200** dopo attesa massima 55 secondi. I timeout precedenti non provavano un servizio assente.

Servizi distinti che NON vanno modificati: `freept-bridge-production` (`srv-dbp2s20u01pc73dfv4lg`), `TX` (`srv-dbk7ab8473hc73frcdfg`), `freept-ota` (`srv-dbq0gfajnfac73enahr0`). Non modificare branch/configurazione/deploy di questi servizi.

Nuova query aggregata Supabase test: 4 utenti Auth, 1 profilo admin approved e 3 profili user approved; bootstrap devices/nonces sempre 0. Non sono stati letti password/token né identificativi personali dei profili; non usare il conteggio come prova di credenziali di login disponibili.

### Blocco attuale concreto

Il connettore Render espone deploy e aggiornamento delle variabili, ma non il cambio ramo del servizio o la lettura dell'intera configurazione d'ambiente. Nessuna CLI Render o API key Render locale disponibile (verificata solo la presenza, nessun segreto stampato).

Aperto il pannello del SOLO servizio staging per il cambio ramo, usando il fallback browser. Il browser non era autenticato. Attraverso la richiesta sicura l'utente ha scelto Render → GitHub → Google. Dopo l'invio protetto della password, Google ha mostrato **Your password was changed 5 months ago**; accesso non riuscito e nessun retry automatico.

Il browser deve essere completato tramite handoff di autenticazione. Non chiedere password o OTP in chat, non ricostruire URL OAuth con parametri e non copiare cookie/sessioni in shell o strumenti. Dopo la ripresa verificare prima lo stato visibile del browser e il ritorno a Render; non dedurre il login da un popup chiuso.

### Prossima azione dopo autenticazione riuscita

1. Verificare che il pannello sia del servizio test `srv-dbo9t6lg1s2s73ejjtn0` nel workspace confermato. Preservare piano free e auto-deploy off.
2. Preparare/controllare il cambio verso `work/unified-verified-20261119`, senza toccare il vecchio ramo GitHub o i servizi produzione. Verificare in sicurezza solo gli elementi di configurazione test necessari; non esporre service_role/secret.
3. Prima del deploy verificare URL Supabase test esatto, validità credenziali backend e gate `FREEPT_BRIDGE_BOOTSTRAP=STAGING_DEVICE_KEY_V1`, origini native ammesse e health path. Se emerge una scelta di costo/nuova risorsa o una modifica fuori test, chiedere la decisione concreta all'utente.
4. Riprendere l'end-to-end reale e la pipeline sperimentale come descritto sopra. Non usare il workflow staging storico con ramo obsoleto/biometria residua per pubblicare la nuova APK senza consolidarlo.

Questa fase ha prodotto solo letture e tentativo di login. Nessun cambio ramo Render, deploy, variabile, ruolo, dato, nuova APK o prova Android end-to-end è stato eseguito. I risultati precedenti restano storici.

## STATO AUTOREVOLE PIÙ RECENTE — ripresa dopo autenticazione (19 novembre 09:37 CET)

Le sezioni precedenti sono storico: **Render è ora autenticato e il gateway staging è stato aggiornato e distribuito**. Non chiedere nuovamente il login Render o la conferma workspace se la sessione è ancora valida.

- Partenza effettiva letta: `ec66b84a8cf1de41b316cc041123758b7436505d`.
- Servizio test invariato `srv-dbo9t6lg1s2s73ejjtn0`, workspace `tea-daslui3ncjis73anu1v0`.
- Branch ora `work/unified-verified-20261119`; piano free; autoDeploy no/off; health `/health`.
- URL `https://freept-bridge-staging.onrender.com`; Supabase test esatto `aqjuixbuxftnjfzxmzuj`; origine consentita `https://localhost`; gate bootstrap `STAGING_DEVICE_KEY_V1` aggiunto via merge preservando segreti.
- Aggiornamento ambiente tramite API ha avviato deploy `dep-dbvb9nc9v7es73989ccg` da ec66b84, LIVE alle 08:36:06 UTC. Nessun secondo deploy richiesto. Nessun deploy produzione.
- Nuove prove HTTPS reali 12/12 PASS, risultato in `reports/FreePT-live-HTTPS-2026-11-19.json`. Script riproducibile `scripts/verify-bootstrap-staging.mjs`, opt-in esplicito `FREEPT_LIVE_STAGING_PROBE=CREATE_AND_CANCEL_SYNTHETIC_DEVICE`. Usa solo chiavi Node effimere per un pending sintetico, poi cancel firmato; non file o account personali.
- Verifica DB successiva: 4 auth.users, profili 1 admin approved/3 user approved invariati. Un solo bootstrap sintetico locale `b8079bdc-20a0-4ad0-aa1d-8395d1493c49`, senza admin/owner, received=0, revocato. Nessun bridge_devices corrispondente.
- 11 test automatici mirati PASS e script sintatticamente valido. Non ripetuti test storici; nessun test fisico dichiarato.
- Nuovo workflow GitHub `bridge-https-live-staging.yml` pubblica JSON delle prove live. Non confondere eventuale PASS con E2E Auth completo. La run creerà un secondo dispositivo sintetico distinto, anch'esso cancellato: conteggi globali successivi potranno quindi aumentare senza nuovi utenti personali.
- `render.yaml` specchio documentale allineato, nessuna Blueprint sync. Non eseguire `render deploy` per creare altri servizi.

### Prossimo blocco concreto

**Serve login Supabase Auth legittimo dell'amministratore test**, distinto dall'account Render, e un utente personale di prova autorizzato per il successivo claim. Nessuna credenziale valida disponibile nell'ambiente agente; non ricavare password dal browser, non chiedere token/password in chat, non cambiare ruoli o credenziali. Usare una superficie di login sicura al solo progetto test, con intervento utente protetto se necessario. Non presumere che gli account esistenti siano automaticamente utilizzabili o sacrificabili.

Dopo autenticazione test valida:
1. Preparare harness E2E che acquisisca le sessioni senza esporle, usando `auth.getUser` sul progetto test e normali ruoli/policies. Start firmato pending, approve via bearer admin, errore codice/replay, fixture 300000 byte/2 chunk/hash, claim con accountProof vincolato al token personale approvato, revoca/scadenza. Non usare INSERT/UPDATE privilegiati per simulare approvazioni. Pulire solo fixture autorizzate.
2. Consolidare `.github/workflows/bridge-android-staging.yml`: solo ramo work, nome FreePT TEST, package it.freept.bridge.next, gate bootstrap nativo+web true, endpoint HTTPS e progetto test esatto, rimuovere passo biometria residuo. Non modificare pipeline/package produzione.
3. Build automatica, firma stabile Bridge, verifica fingerprint/package/manifest/Firebase/test endpoint realmente inclusi, nessun segreto/fallback produzione. Pubblicare APK sperimentale solo se criteri di sicurezza/configurazione soddisfatti; se no, trattenerla.
4. Collaudi Android emulator disponibili distinti da fisico; Oppo/Keystore hardware/SAF fisico NON ESEGUITI finché non osservati. Protocollo già presente, non riscriverlo come test passato.
5. Aggiornare rapporto, evidenze, link run, SHA effettivi e questo checkpoint prima di interrompere.

Nessuna nuova APK in questa ripresa. Accesso Render e 12 controlli HTTPS sono conclusi, E2E autenticato completo e APK restano aperti.

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
