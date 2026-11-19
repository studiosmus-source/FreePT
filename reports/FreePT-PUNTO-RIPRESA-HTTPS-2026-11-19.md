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
