# FreePT Bridge — contratto tecnico e confini di integrazione (bozza)

Stato: progettazione; nessun trasferimento remoto implementato. Base verificata: FreePT main 84b7dd0bf0b0863d148fa7c85a3f10a71d67b90c e TX feature/nomedia-gallery-20261103. Questo documento non è una certificazione di compatibilità.

## Invarianti
- La chat utente FreePT resta invariata (accesso, messaggi, allegati, notifiche, persistenza).
- La sezione Bridge aggiuntiva è visibile soltanto nella modalità amministratore già autenticata, con verifica di ruolo **anche lato server** per ogni API; il solo controllo JS non è una barriera di sicurezza.
- La schermata di onboarding propone una spiegazione unica e una spunta globale, ma NON sostituisce le finestre obbligatorie Android e il consenso informato al collegamento.
- L'utente abilita esplicitamente il Bridge per un ricevitore identificato e può revocarlo in ogni momento. Il ricevitore non ottiene diritti solo grazie all'autorizzazione della chat.
- Gli accessi e i trasferimenti devono essere autorizzati e verificabili dal proprietario del dispositivo: nessuna funzione di accesso occulto o elusione di indicatori richiesti dal sistema.
- Download e anteprime non devono aprire finestre o notifiche ripetitive per ogni file. Le notifiche di servizio/indicatori previsti da Android restano visibili.
- Niente modifica di credenziali Supabase/Render, produzione o dati esistenti in questa fase.

## UI amministratore
- Tab **Approvazioni**: richieste di associazione Bridge separate dalle approvazioni della chat; dispositivi autorizzati, online/offline, revoca.
- Tab **File**: scelta del dispositivo autorizzato, esplorazione delle sole aree esplicitamente condivise, anteprima e scaricamento; download intere cartelle solo con controllo di dimensione, profondità, spazio libero, annullamento e gestione errori.
- Le schede vuote mostrano “Bridge non configurato”, non una falsa connessione.

## Protocollo (da implementare, NON presente oggi)
1. Identità stabile e distinta per ciascun TX, con credenziale individuale.
2. Un RX può selezionare un solo dispositivo destinatario per singola richiesta; job e risposta sono vincolati al device_id sia in accodamento sia alla consegna.
3. Pairing e revoca individuali, con scadenze/token ruotabili; nessun token TX globale condiviso tra telefoni.
4. Catalogo e trasferimenti con paginazione, limiti di velocità, retry limitati e cancellazione; nessuna copia persistente non necessaria sul relay.
5. Registrazione server dei consensi, delle revoche e degli accessi per consentire verifica e diagnosi.
6. Proprietario del dispositivo sempre in grado di vedere se il Bridge è attivo e revocarlo. L'eventuale chiusura del Ponte interrompe le funzioni applicative locali previste e genera un evento di disattivazione per l'amministratore quando la rete è disponibile; un'assenza di heartbeat non equivale a una revoca esplicita.

## Android e consumi
- Un foreground service richiede la notifica di sistema; nome proposto: **FreePT · Bridge attivo**, con icona del ponte. Un'icona dell'app non sostituisce la notifica foreground.
- Android 15+ limita sia l'avvio di servizi dataSync da BOOT_COMPLETED sia il tempo cumulativo dataSync in background. Non promettere disponibilità continua o riavvio automatico in ogni condizione.
- Mantenere trasmissioni e scansioni su richiesta; riconnessione con backoff e limiti di consumo. Misurare su dispositivo reale prima di dichiarare miglioramenti.
- Richiedere permessi nel punto d'uso; “accesso a tutti i file” richiede percorso Android dedicato e non supera le protezioni di dati privati di altre app.

## Gate prima di una build distribuibile
- Audit completo app Android Capacitor/Gradle di FreePT (manifest generato, plugin, permessi, avvio).
- Audit completo di TX/RX/relay inclusi chiamanti, persistenza e vecchie implementazioni su branch.
- Test server su due TX simultanei per escludere risposta dal telefono errato.
- Test di revoca e riattivazione, utenti autorizzati e non, rete assente, richiesta scaduta.
- Test di assenza di regressioni chat e upload grandi, più verifica delle notifiche e batteria su Android 15/16 e ColorOS.
- Prima della merge, build APK, firma stabile e test funzionali reali.

## Stato del modello di persistenza
- Il modulo `bridge/deviceRouting.mjs` espone `snapshot()` e `fromTrustedSnapshot()`: serializza dispositivi e associazioni ancora valide.
- Snapshot e ripristino sono gestiti dal modello in memoria; è disponibile anche `bridge/localSnapshotStore.mjs`, adattatore di prova su file locale. Non esiste ancora persistenza condivisa di produzione; le migrazioni Supabase e le RPC proprietario sono predisposte ma non applicate. Il filesystem Render non è un database affidabile.
- Al ripristino `online` torna `false`, nessun job pendente viene ripristinato e ogni dispositivo deve riconnettersi e autenticarsi al backend.
- La funzione di ripristino deve accettare esclusivamente dati già validati dal server e provenienti da un archivio attendibile. Non usarla direttamente con input dell'utente.
- Il prototipo JS non è un sistema di autenticazione: autorizzazioni e revoca richiedono verifica lato backend anche durante stream/trasferimenti in corso.
- Sono presenti dieci test del modello e sei test dell'archivio locale. Non è ancora confermato l'esito del workflow CI del repository.

## Interruttore Bridge nel modello
- `setBridgeEnabled({deviceId, ownerId, enabled})` impone l'identità del proprietario, cancella le richieste in coda e impedisce nuove consegne quando il Ponte è disattivato.
- Lo stato di disattivazione è incluso nello snapshot e resta valido dopo un riavvio; la presenza in rete è separata dall'intenzione di chiudere il Ponte.
- Il comando è **solo una funzione del modello logico**: non interrompe ancora la sessione chat FreePT, il servizio Android o le notifiche e non informa ancora l'amministratore. Serve l'integrazione autenticata lato server e Android.
- Sono presenti 14 test del modello, 6 test per lo store su file e 3 controlli del contratto SQL. I 14 test del modello sono stati eseguiti con un runner JavaScript adattato; l'esecuzione Node.js/CI completa resta da verificare.
- `getDeviceStatus` distingue `online`, `offline` e `closed_by_owner`; un heartbeat ricevuto mentre il Ponte è chiuso non lo riattiva. La riattivazione richiede una nuova presenza di rete autenticata (da integrare nel backend).

## Migrazione server predisposta (non applicata)
- `supabase/migrations/20261106_bridge_foundation.sql` crea due tabelle isolate: `bridge_devices` e `bridge_grants`, con chiavi esterne a `profiles`, RLS e scritture negate ai client.
- `supabase/bridge_preflight.sql` verifica in sola lettura tabelle, RLS e privilegi dopo l'applicazione in un **progetto di prova**.
- L'amministratore approvato può leggere soltanto dispositivi collegati a una sua autorizzazione ancora attiva; il proprietario approvato vede i propri. I client non possono concedere o revocare diritti con scritture dirette.
- Sia SQL sia `BridgeRegistry` inizializzano un dispositivo con `bridge_enabled=false`. L'attivazione è esplicita nel modello; la transazione autenticata di attivazione lato backend non è ancora implementata.
- Le tabelle non generano token, non provano il possesso del dispositivo, non implementano audit o trasferimenti. Solo un backend autenticato potrà gestire associazioni e revoche. Non usare una chiave `service_role` nel client.
- **Questa migrazione non è stata applicata a Supabase e non è stata validata con un database PostgreSQL reale.**

## Comandi proprietario predisposti (non applicati)
- La migrazione separata `supabase/migrations/20261106_bridge_owner_controls.sql` definisce tre RPC per un dispositivo **già registrato da un backend attendibile**: `bridge_owner_set_enabled`, `bridge_owner_grant` e `bridge_owner_revoke`.
- Ogni RPC ricava l'identità da `auth.uid()`, richiede un profilo approvato e blocca la riga del dispositivo con `FOR UPDATE` verificando `owner_id`. Gli argomenti non attribuiscono mai il ruolo di proprietario.
- L'autorizzazione può essere data soltanto a un profilo amministratore approvato. La revoca agisce su una sola coppia dispositivo/ricevitore. I client non ottengono scritture dirette alle tabelle.
- Sono predisposti tre test statici del contratto RPC, eseguiti nel runner JavaScript adattato. Non sono test d'integrazione PostgreSQL, Supabase o RLS reale.
- Ancora mancanti: registrazione e autenticazione forte del singolo TX, log/audit, sessioni, annullamento dei trasferimenti in corso, persistenza di presenza e integrazione Android. La sola modifica di `bridge_enabled` nel database non può arrestare un trasferimento già avviato.
- Nessuna delle migrazioni Bridge è stata eseguita sul database reale. L'attivazione in produzione richiede prima collaudo isolato e verifica completa della catena backend.

## Audit di consenso e revoca (solo migrazione di prova)
- `supabase/migrations/20261106_bridge_audit.sql` aggiunge `bridge_audit_events` con eventi `bridge_enabled`, `bridge_disabled`, `access_granted`, `access_revoked`.
- I trigger SQL sono eseguiti nella stessa transazione che modifica `bridge_devices` o `bridge_grants`; un errore nella scrittura del log causa l'annullamento della modifica.
- Solo il proprietario approvato può leggere gli eventi relativi ai propri dispositivi. I client non possono inserire, modificare o cancellare direttamente eventi e non hanno EXECUTE sulle funzioni trigger.
- `supabase/bridge_preflight.sql` verifica anche tabella audit, RLS, privilegi e presenza dei trigger.
- L'audit registra cambiamenti di consenso e autorizzazione, **non ancora** accessi a file, trasferimenti o provenienza verificata del telefono. La cancellazione di un dispositivo elimina anche i relativi eventi per effetto della chiave esterna CASCADE: non è un archivio immutabile di conservazione.
- Tre controlli statici aggiuntivi sono passati in runner JS adattato; la migrazione non è stata provata in PostgreSQL e non è stata applicata al database reale.

## Credenziali individuali TX (prototipo non connesso)
- `bridge/deviceCredentials.mjs` introduce segreti casuali da 256 bit, uno per ciascun dispositivo. Una rotazione invalida il segreto precedente nella stessa istanza, e la revoca non coinvolge gli altri TX.
- Il modello conserva un verificatore SHA-256 con salt individuale e confronto a tempo costante. Il segreto viene restituito una sola volta all'atto dell'emissione/rotazione e **non** compare nello snapshot di `BridgeRegistry`.
- `supabase/migrations/20261106_bridge_device_verifiers.sql` prepara una tabella privata per i verificatori con RLS e nessun privilegio client; `supabase/bridge_preflight.sql` include i controlli di visibilità.
- L'emissione non verifica ancora il proprietario: **non invocare la primitiva direttamente da un endpoint pubblico**. In produzione servono registrazione con identità Auth verificata, verifica consenso, connessione TLS, archiviazione transazionale, limitazioni dei tentativi, protezione contro il riutilizzo e gestione sicura del segreto nell'Android Keystore.
- Un bearer secret prova solo il possesso della credenziale, non l'identità fisica del telefono. Non ci sono ancora API online, sessioni autenticabili o transfer sicuri. Le migrazioni restano file GitHub non applicati.

## Sessioni TX a durata limitata (modello isolato)
- `bridge/deviceSessions.mjs` crea sessioni TX casuali con durata massima di cinque minuti. Il backend deve verificare la credenziale individuale prima dell'apertura e ripetere i controlli di autorizzazione a **ogni operazione**.
- La verifica controlla dispositivo, verificatore aggiornato, grant del ricevitore e presenza/stato del Ponte. Rotazione e revoca della credenziale invalidano le sessioni precedenti.
- Il contatore temporaneo `sessionEpoch` nel registro cambia al comando OFF **e alla revoca di un'autorizzazione attiva**: un token precedente non torna valido dopo un nuovo ON o un nuovo GRANT. L'invalidazione per revoca è prudenzialmente estesa a tutte le sessioni di quel TX; gli altri telefoni non sono coinvolti. Il contatore non è un segreto e non viene persistito: le sessioni esistono soltanto nel processo.
- L'identità del ricevitore che autorizza un'operazione deve arrivare da un contesto **autenticato dal backend**, mai da un parametro HTTP non verificato. Per ora nessuna API HTTP o connessione Android usa queste funzioni.
- Sono predisposti undici test delle sessioni, non ancora confermati nel workflow GitHub Actions. L'apertura viene inoltre respinta se il dispositivo è offline o Bridge è disattivato. Senza un archivio server condiviso, verifica delle richieste, TLS e protezioni contro replay/rate-limit questo modello **non è pronto per l'utilizzo reale**.

## Collegamento logico amministratore → TX (isolato, non esposto)
- `bridge/bridgeService.mjs` collega richiesta dell'amministratore, coda per dispositivo, verifica della sessione TX, ritiro e completamento di un job; al momento l'unica operazione prevista è `list`, senza percorsi file, lettura dati o trasferimento.
- `requestList` non accetta un receiverId libero: un adattatore backend **deve** validare un JWT Supabase e restituire l'identità di un admin approvato. Il callback di prova non è autenticazione reale.
- Un TX non ritira una richiesta senza sessione autenticata; il completamento ricava il receiver dal job conservato lato server e non da un parametro fornito dal telefono.
- Cinque test di integrazione logica (runner JS adattato) controllano flusso completo, amministratore falso, TX sbagliato, revoca e token invalido.
- Questo modulo è un prototipo **in-process**: non usa ancora endpoint HTTP, autorizzazione Supabase reale, transazioni database, autorizzazione di cartelle Android, canale streaming o distribuzione multiprocesso. Il modello in memoria non è una garanzia di revoca su servizi remoti.

## Gestione delle richieste Bridge (modello isolato)
- `BridgeRegistry` ora limita la coda a 100 lavori attivi per istanza e fissa una scadenza di 60 secondi per ciascuna richiesta, compresi i lavori già consegnati. I limiti sono parametrizzabili nei test e la coda viene ripulita prima di aggiunte, prelievi e completamenti.
- L'unica operazione accettata nel modello è `list`. Non esistono operazioni di accesso arbitrario a file, cancellazione o comandi remoti.
- `BridgeService.cancelRequest` e `getRequestStatus` richiedono la stessa verifica di identità amministratore di `requestList`. Il proprietario della richiesta è ricavato dall'identità verificata lato server, non dagli argomenti inviati dal TX.
- Un annullamento rimuove un lavoro anche quando risulta già `sent`, impedendone il completamento nel modello. Le richieste scadute non vengono ritirate né completate, e quelle cancellate non possono riapparire.
- Cinque test di regressione della coda e due del servizio sono stati aggiunti. Nel runner JS adattato i 38 test relativi a instradamento, sessioni e servizio sono passati, ma la verifica Node.js nativa e l'integrazione reale non sono state ancora effettuate.
- **Questo è controllo del ciclo di vita nel processo di prova, non un vero sistema distribuito**: la cancellazione deve ancora propagarsi al servizio Android e interrompere eventuali operazioni native in corso, mentre rate limit e identificazione reale delle sessioni richiedono un backend autenticato.

## Esito consultabile delle richieste (retention temporanea)
- I lavori `list` completati o annullati restano nel registro **solo fino alla scadenza già prevista** per la richiesta, consentendo a `getRequestStatus` di restituire `done` o `cancelled` all'amministratore autenticato.
- Durante il periodo di conservazione non è consentito riutilizzare lo stesso `jobId`, reinviare un lavoro finale, completarlo due volte o annullare un lavoro già finale. I record terminati non occupano la capacità riservata ai lavori attivi.
- Alla scadenza la voce è rimossa; non è un archivio audit né una persistenza riavviabile.
- Sono stati aggiunti tre test mirati (uno sul servizio, due sul modello). La suite adattata di routing, sessioni e servizio risulta 41/41. **Non è stata ancora eseguita la suite Node.js nativa sul checkout del repository privato.**

## Disconnessione e riconnessione TX (solo modello in-process)
- La transizione online→offline incrementa `sessionEpoch` e invalida il token TX precedente. La riconnessione non è un'autenticazione: serve aprire una sessione nuova; il permesso dato dal proprietario rimane distinto dalla disponibilità di rete.
- I job `sent` del telefono che si disconnette diventano `cancelled` e non possono essere completati successivamente; i job ancora `queued` restano in attesa soltanto fino alla loro scadenza naturale. Eventi offline ripetuti non incrementano inutilmente la generazione della sessione.
- Due test mirati aggiunti; l'esecuzione nel runner JavaScript adattato di routing/sessioni/servizio ha dato 43/43. L'integrazione effettiva con rete, Supabase e Android resta non collaudata. L'evento `setOnline` potrà essere invocato soltanto da un backend attendibile dopo una connessione autenticata, **mai** su dichiarazione libera del telefono.

## Vincolo dei job alla sessione TX (modello isolato)
- Ogni lavoro consegnato con `BridgeService.pollDevice` è vincolato a un identificatore crittografico ricavato dal **token della specifica sessione TX** che lo ha ritirato. Il token originale non viene salvato nel job né restituito nelle risposte.
- `BridgeService.completeDevice` richiede una sessione autenticata con lo stesso identificatore. Un secondo login dello stesso telefono non può completare lavori ritirati da un'altra sessione, neppure se la credenziale del dispositivo è identica.
- Le API puramente interne di `BridgeRegistry` conservano la possibilità di testare il modello senza legami di sessione; questa modalità non è un'API esposta al telefono.
- Due regressioni dedicate verificano sessioni parallele e chiusura della sessione che ha ritirato il lavoro. Nel runner adattato routing/sessioni/servizio: **45/45** controlli superati, senza esecuzione nativa Node.js o validazione di rete.

## Verifica automatica Node.js su GitHub Actions
- Il workflow `.github/workflows/bridge-checks.yml` esegue `npm run test:bridge` su Node.js 22. Nei log del run `42246975535` (commit `96f605245780dec5f600a9e676f6629453a1e67a`) sono presenti **67 test, 67 superati, 0 falliti**: sono test Node reali, non un runner JavaScript adattato.
- Il workflow è stato esteso per controllare con `node --check` ogni `bridge/*.mjs` e `src/main.js`. Il run `42248727349` sul commit `57cf98e557c9c4a19ab28abb7c2e2e7abf1228c5` è **riuscito**: 67 test Node nativi superati, zero fallimenti, e controllo sintattico di tutti i moduli Bridge e del punto d'ingresso FreePT completato.
- Le prove confermano il comportamento dei moduli e i contratti statici SQL; **non** equivalgono a test PostgreSQL, Supabase, connessioni Android, trasferimenti o controllo di sicurezza di un sistema distribuito.

## Prima connessione TX autenticata (modello isolato)
- Il prototipo separa il primo collegamento dalla semplice apertura di una sessione già online. `BridgeDeviceSessionGate.connect`, richiamabile da `BridgeService.connectDevice`, verifica il segreto individuale e che il proprietario abbia esplicitamente attivato Bridge **prima** di impostare la presenza online.
- Questo elimina la dipendenza circolare che richiedeva a un telefono appena avviato di risultare online prima dell'autenticazione. Restano invariati il blocco del consenso OFF, le credenziali distinte, la revoca delle sessioni vecchie e la scadenza dei token.
- La primitiva resta interna a un unico processo e **non** è un endpoint HTTP. Occorrono un backend autenticato, persistenza affidabile e collegamento al servizio Android prima di poterla usare con telefoni reali.
- Aggiunti quattro test di sessione e due test di servizio per avvio offline, credenziali non valide, OFF del proprietario, riavvio e flusso fino al completamento. Il workflow nativo GitHub Actions `42249686124`, eseguito sul commit `d442f6e476b9db8bae03ed758508f684d237fca1`, è terminato con **73 test superati su 73**, zero fallimenti e controlli di sintassi superati.

## Verifica amministratore Supabase (adattatore backend isolato)
- `bridge/supabaseAdminAuth.mjs` aggiunge `createSupabaseBridgeAdminAuthenticator`, che dipende da due client **server-side** forniti dal backend: verifica l'access token tramite `auth.getUser(token)` e legge `profiles(id,role,status)` per l'identità restituita da Auth.
- L'accesso Bridge amministratore è consentito soltanto quando il profilo di database corrisponde allo stesso Auth user, ha `role='admin'` e `status='approved'`; account anonimi, dichiarazioni di ruolo nel payload, errori di Auth o query e token malformati vengono respinti.
- Il modulo non contiene URL, service key, nuove rotte HTTP o chiamate reali a Supabase. Il callback è da creare **esclusivamente sul server** con configurazione riservata. L'integrazione del validatore all'endpoint di rete, il controllo di revoca transazionale e il collegamento database reale restano da sviluppare.
- `bridge/supabaseAdminAuth.test.mjs` contiene sette test per verifica positiva, spoofing, ruoli non ammessi, credenziali errate, indisponibilità dei servizi e utilizzo con `BridgeService`. GitHub Actions run `42250316149` sul commit `95861ecb3feb56bc5287c89764e908372bd69d8b`: **80 test Node.js superati su 80, 0 falliti**, controllo di sintassi Bridge/FreePT superato. I client Supabase nei test sono mock, non un database PostgreSQL reale.

## Contratto richieste amministratore Bridge (modulo isolato)
- `bridge/adminRequestHandler.mjs` definisce un dispatcher **in-process**, non un listener HTTP: accetta solo `POST /bridge/admin/list`, `POST /bridge/admin/status`, `POST /bridge/admin/cancel`. Tutte le altre rotte o i metodi non previsti vengono respinti.
- L'identità viene ricavata unicamente dall'header `Authorization: Bearer …`, passato all'autenticatore Supabase del backend. Campi `receiverId`, `role`, `accessToken` o parametri extra nel corpo sono respinti. Il `jobId` della richiesta `list` è generato sul server con `randomUUID`.
- Per questa prima versione, `deviceId` e `jobId` devono essere UUID validi. Le risposte di errore non rivelano se un lavoro appartiene a un altro amministratore o non esiste. Non sono implementati accesso arbitrario al filesystem, upload, download o comandi remoti.
- **Manca il listener HTTPS reale** che impone TLS, limiti al corpo, rate limiting, controllo degli header e separazione dei ruoli TX/admin. Il dispatcher non è da esporre così com'è direttamente a Internet; gli adattatori Supabase e il modello in memoria non costituiscono ancora un backend pronto alla produzione.
- Nove test di contratto sono stati aggiunti e verificati nel workflow GitHub Actions `42258875940` (commit `cd6751ef7ad6dbe2357e8faf37d335d094e7eb99`): **89 test Node.js superati su 89, 0 falliti**, controlli sintattici superati. Nessuna connessione reale a Supabase, Render o Android è stata effettuata.

## Adattatore HTTP locale di prova (Node.js)
- `bridge/loopbackHttp.mjs` aggiunge un listener di collaudo limitato a `127.0.0.1`, con porta scelta dal sistema operativo. Il server accetta soltanto i tre percorsi amministrativi già previsti dal contratto `adminRequestHandler`. Richiede JSON e limita il corpo a 2048 byte; risponde con JSON senza cache e senza accessi al filesystem.
- **Non è un server di produzione**: non configura TLS, autenticazione Supabase reale, rate limit o bilanciamento. Non espone alcuna rotta per enrolment TX, accesso ai file Android o trasferimenti. Il listener di prova viene aperto e chiuso esclusivamente dai test.
- `bridge/loopbackHttp.test.mjs` contiene cinque test con richieste HTTP reali tramite `fetch` Node: flusso amministratore→coda→TX simulato→completamento→status, diniego credenziali/ruolo, richieste malformate o troppo grandi, blocco di rotte non previste e verifica del bind locale.
- GitHub Actions run `42264442524` (commit `25996e14574c7c7dd528ca71739553b4c6c2f1e2`) ha eseguito **94 test nativi Node.js, tutti superati, zero fallimenti**, oltre ai controlli sintattici di Bridge e del punto d'ingresso FreePT.
- I test HTTP sono svolti su loopback con Auth/profili simulati, non dimostrano l'interoperabilità con servizi Supabase/Render reali né con il telefono Android. Il prossimo gate è un backend HTTPS di staging, con autenticazione e consenso realmente persistiti e test di sicurezza e revoca in rete.

## HTTP locale completo amministratore–TX (modello di prova)
- `bridge/txRequestHandler.mjs` introduce un contratto TX in-process limitato a `POST /bridge/tx/connect`, `/bridge/tx/poll` e `/bridge/tx/complete`, con verifica stretta degli argomenti. Nessun elenco file del sistema, lettura, download, shell, enrollment o trasferimento è disponibile.
- `bridge/loopbackHttp.mjs` consente di collegare opzionalmente il dispatcher TX nel **solo** server di test locale `127.0.0.1`. Senza `txHandler` le rotte TX restano indisponibili.
- `bridge/txRequestHandler.test.mjs` aggiunge sei test Node con vere richieste HTTP: autenticazione TX, richiesta amministratore, ritiro e completamento, separazione fra telefoni e sessioni, credenziali e consenso proprietario non validi, payload non ammessi e assenza delle rotte TX nel server admin-only.
- GitHub Actions run `42273879607` (commit `a5c5065109872bbe110e050d934e101bfff0d3f1`): **100/100 test Node.js nativi superati**, zero errori e controlli sintattici riusciti.
- Queste prove restano in loopback con modelli e utenti simulati: non certificano HTTPS pubblico, autenticazione Supabase reale, database persistente, due telefoni Android fisici o trasferimento file. L'attivazione fuori dallo staging richiede consenso verificato, protezioni anti-abuso e prove specifiche su dispositivi reali.

## Limitazione dei tentativi di autenticazione TX (solo prototipo locale)
- `bridge/txRequestHandler.mjs` applica un limite ai tentativi di connessione falliti: predefiniti **5 errori in 60 secondi**, seguiti da **60 secondi di sospensione** per l'ID dispositivo dichiarato. Le risposte durante la sospensione sono `429 tx_rate_limited` e non interrogano nuovamente le credenziali. Una connessione riuscita cancella i fallimenti registrati.
- I contatori sono separati per ID dispositivo e limitati a 1000 voci per processo; i valori e l'orologio sono iniettabili per i test. Non esistono archiviazione persistente, sincronizzazione distribuita o blocchi permanenti.
- **Limite di sicurezza:** un aggressore che conosce un ID potrebbe causare temporaneamente il blocco del relativo telefono: questa misura non basta per un servizio pubblico. Lo staging richiederà limiti per provenienza verificata, gestione anti-DoS, segnali affidabili di rete e persistenza condivisa. È vietato considerare questa sola protezione pronta per Internet.
- Quattro regressioni verificano cooldown, isolamento tra due TX, memoria limitata e opzioni non valide. GitHub Actions run `42274396956` sul commit `566f419a2d8cb89f310c03b94826ce822ee01a4a`: **104 test Node.js su 104 superati**, zero errori, controlli sintattici superati.

## Sostituzione delle connessioni TX autenticate
- `BridgeDeviceSessionGate.connect` tratta una nuova connessione con credenziale valida come sostituzione della precedente: quando il dispositivo risulta già online, applica una disconnessione logica e poi la nuova connessione, riutilizzando il meccanismo esistente di invalidazione `sessionEpoch` senza sovrapporre una seconda implementazione.
- Lavori già consegnati a quel dispositivo diventano `cancelled` e non sono completabili né dalla vecchia sessione né dalla nuova; i lavori ancora `queued` restano disponibili entro la scadenza originaria. I dispositivi diversi non sono coinvolti.
- Credenziali sbagliate e consenso OFF vengono verificati **prima** della sostituzione, per non interrompere una connessione valida a seguito di tentativi non autorizzati.
- Tre test di regressione aggiunti: sessione precedente invalidata, errore credenziali che non altera la sessione attiva, preservazione dei lavori pendenti e isolamento del secondo TX. GitHub Actions run `42274854238` (commit `0ec9ad781510f2f34a308d1e509a815e8038aff0`): **107/107 test Node.js superati**, zero fallimenti, sintassi superata.
- È ancora un modello in memoria su loopback; il meccanismo di riconnessione effettivo del telefono Android, i tempi di rete e la persistenza distribuita sono da integrare e collaudare separatamente.

## Capacità e pulizia delle sessioni TX (modello isolato)
- `BridgeDeviceSessionGate` ha ora un limite configurabile `maxSessions` (predefinito **1000**) per le sessioni in memoria. Un nuovo accesso non può far crescere la tabella indefinitamente: se la capacità è esaurita viene rifiutato con `device_session_capacity`, senza emettere un token aggiuntivo.
- Prima di emettere una sessione nuova vengono rimossi i token scaduti e quelli appartenenti a generazioni di sessione già sostituite. La rimozione di una sessione superata può produrre `invalid_device_session` anziché `device_session_revoked`; entrambi significano che il token è inutilizzabile. I token già attivi e non scaduti restano validi fino alla scadenza, revoca o sostituzione.
- Quattro regressioni aggiunte per limite, recupero dopo scadenza, pulizia delle sessioni sostituite e rifiuto di opzioni non valide. Dopo aver allineato due asserzioni precedenti alla nuova pulizia, il run GitHub Actions `42275683971` (commit `bac9f0b2be3110e0db4605dff3986717cc150f54`) ha confermato **111 test Node.js su 111 superati**, zero fallimenti e controllo sintattico superato.
- Restano da definire gestione di più istanze server, sincronizzazione di presenza e credenziali, recupero dalla capacità esaurita e limiti anti-DoS distribuiti; non usare direttamente questa tabella in memoria come stato di autenticazione di produzione.

## Collaudo di riavvio locale Bridge
- `bridge/recoveryIntegration.test.mjs` riutilizza `LocalBridgeSnapshotStore` e le primitive esistenti, senza introdurre nuovi strati di persistenza o modificare i contratti di produzione.
- Il test principale salva il registro prima di simulare la perdita del processo. Dopo il ripristino tramite nuovo oggetto `LocalBridgeSnapshotStore`, verifica che dispositivi, consenso attivo e switch del proprietario sopravvivano, ma **stato online, token TX e lavori `sent`/`queued` no**. La vecchia sessione non può autorizzare operazioni; il TX autenticato nuovamente può ricevere soltanto nuovi lavori.
- Il test usa un verifier TX importato tramite `importTrustedVerifier` da un valore mantenuto nel fixture attendibile **in memoria**: non implementa ancora il salvataggio delle credenziali TX in PostgreSQL né prova l'accessibilità di un database reale.
- Ulteriori prove coprono switch OFF, revoca permanente e rifiuto di stato salvato corrotto. GitHub Actions run `42276269989` sul commit `e54a123596e622a00993a15fccdac96a1f47bb3d`: **114/114 test Node.js superati**, zero fallimenti, sintassi superata.
- Questa verifica riguarda il riavvio del modello locale, non un failover multiistanza, il riavvio di Render o la ripresa di una connessione Android reale.

## Checkpoint di autorizzazione condivisa (contratto non integrato)
- `bridge/authorityCheckpoint.mjs` definisce `BridgeAuthorityCheckpoint`: a ogni invocazione richiede una lettura autorevole e aggiornata della coppia dispositivo/amministratore `(deviceId, receiverId)`. Una riga è accettata soltanto se gli ID coincidono, lo switch del proprietario è ON, il grant è attivo e il ricevente è approvato. Risposte mancanti, incomplete o discordanti vengono negate; gli errori di lettura non ripiegano sulle autorizzazioni presenti in memoria.
- Sei test nativi verificano isolamento fra coppie, revoca vista da due gate con registri locali obsoleti, switch OFF, perdita di approvazione, indisponibilità della fonte e dati malformati. GitHub Actions run `42280376275` sul commit `cefdb7fca1c4fc2303ff9d684153ff326ab90936`: **120/120 test Node.js superati**, zero errori, controlli sintattici superati.
- **Non è ancora una revoca distribuita funzionante:** il contratto `readAuthorization` è simulato nei test e NON è collegato a `BridgeService.requestList`, `pollDevice` o `completeDevice`. Non esiste una query PostgreSQL reale, e una semplice lettura separata non garantisce l'atomicità fra controllo, consegna del lavoro e revoca. Per lo staging serviranno una lettura transazionale autorevole e un protocollo di fencing/commit dei job sul database.
- `LocalBridgeSnapshotStore` rimane un supporto soltanto per test locali: non è una fonte attendibile per autorizzazioni multiistanza e non deve essere usato per validare revoche distribuite.

## Integrazione checkpoint nel flusso Bridge (modello isolato)
- `BridgeService` accetta ora un'opzione `authority` verificata all'inizializzazione. Se attivata, `requestList` controlla il consenso fresco della coppia dispositivo/amministratore prima di accodare; `pollDevice` verifica il ricevente associato al primo lavoro pendente prima di consegnarlo; `completeDevice` verifica il ricevente del lavoro già consegnato prima di completarlo.
- `BridgeRegistry.peekNextReceiver` e `lookupDeviceJobReceiver` sono lookup **interni al backend**, non rotte pubbliche. `txRequestHandler` attende le Promise di poll e completion e nega l'operazione in caso di errore. Se la coda cambia durante un controllo asincrono, la consegna viene interrotta anziché applicare una precedente approvazione a un lavoro diverso.
- Il supporto `authority` rimane **opzionale** per compatibilità con il modello di test preesistente; lo staging deve istanziarlo obbligatoriamente con fonte autorevole e non utilizzare il percorso privo del gate.
- Otto test in `bridge/authorityServiceIntegration.test.mjs` coprono l'intero modello: letture fresche a ogni operazione, revoca prima dell'accodamento, revoca prima del dispatch, switch OFF prima della completion, indisponibilità della fonte, errori nel contratto HTTP, sostituzione della coda durante un'attesa asincrona, dipendenza non valida.
- GitHub Actions `42281552765`, commit `22964436a779a3976ea20fc3967464fadbc0474d`: **128 test Node.js su 128 superati**, 0 fallimenti, sintassi verificata.
- **Limite critico:** la verifica autorevole e la mutazione della coda restano due passaggi separati in memoria. Una revoca contemporanea fra il completamento della lettura e la mutazione può ancora produrre una race. È necessario un meccanismo di fencing/transazione persistente sul database per la produzione. Nessun database Supabase reale o dispositivo Android è stato coinvolto.

## Mutazioni sotto lock autorevole (modello transazionale isolato)
- `bridge/transactionalAuthority.mjs` introduce `BridgeTransactionalAuthority`: richiede un'implementazione trusted di `withLockedAuthorization` che controlli consenso e approvazione e mantenga la stessa sezione critica mentre richiama **una sola volta** la mutazione. Non permette mutazioni asincrone, rinviate o replicate e nega richieste se il callback transazionale manca o il backend fallisce.
- `BridgeService` può utilizzare `authority.runAuthorized` per accodamento, dispatch e completion. Mantiene il precedente percorso `assertAuthorized` per compatibilità con i test esistenti. Gli handler HTTP restano invariati e attendono già i risultati asincroni.
- Sette test con lock serializzato simulano revoca prima del dispatch, OFF prima della completion, revoca dopo un lavoro già accodato, indisponibilità del backend, callback ripetuti/differiti e mutazioni non valide. GitHub Actions `42282409085` (commit `a44992300254e5f7ce6724893b0108d41dfe11c8`): **135 test Node.js su 135 superati**, 0 errori, sintassi superata.
- **Nessuna garanzia distribuita ancora:** il lock testato è in memoria e modifica `BridgeRegistry` locale. Per ottenere reale atomicità tra server, la verifica del consenso, il lock sulle righe e la modifica del record del lavoro dovranno avvenire **nella stessa transazione PostgreSQL**. Il callback non è una soluzione sufficiente se l'autorizzazione è nel DB ma la coda resta nella memoria di un processo. Non sono state eseguite migrazioni Supabase né modifiche in Render.
- Le code e le sessioni attuali rimangono modelli locali; non utilizzare questo prototipo come backend pubblico.

## Bozza di coda transazionale PostgreSQL (solo staging)
- `supabase/migrations/20261106_bridge_jobs_staging.sql` crea esclusivamente `public.bridge_jobs`, una tabella di lavori `list` con stati `queued/sent/done/cancelled`, scadenza, UUID, impronta della sessione TX e RLS senza policy utente.
- Tre funzioni `security invoker` utilizzabili solo da `service_role` gestiscono accodamento, claim e completamento. Ciascuna verifica switch Bridge e grant attivo con profilo admin approvato, e blocca `bridge_devices` con `FOR UPDATE`, come già fanno gli RPC di consenso del proprietario. Claim e completamento bloccano anche la riga del lavoro e verificano stato, scadenza e binding TX. Il server deve autenticare realmente amministratore e dispositivo **prima** di ogni chiamata: gli ID e il digest sono dichiarazioni del backend, non prove di possesso.
- `bridge/jobsStagingContract.test.mjs` aggiunge sei test di contratto SQL che controllano isolamento e permessi, vincoli dei lavori, uso coerente del lock del dispositivo, grant/profilo, session binding e firme degli RPC. GitHub Actions `42282990134` sul commit `e33cf471e6168799ad81edfa007ccf3cf9cdd42f`: **141/141 test Node.js superati**, 0 fallimenti, sintassi JS verificata.
- `supabase/bridge_preflight.sql` contiene ora controlli **soltanto in lettura** per presenza della tabella, RLS, divieto di accesso client e tre funzioni server. È una checklist da eseguire solo su staging dopo l'installazione delle migrazioni in ordine.
- **Ancora non collaudato su PostgreSQL**: i test sono statici, non verificano sintassi SQL compilata dal database, lock realmente concorrenti, deadlock o rollback. Il lock del dispositivo è coerente con gli RPC proprietario, ma modifiche dirette via `service_role` e variazioni di `profiles.status` fuori da tale protocollo non sono ancora serializzate: il sistema non è pronto per un uso multiistanza in produzione. Inoltre il modello Node è ancora basato sulla coda in memoria e **non utilizza queste funzioni**; occorre un adattatore backend dedicato.
- Vietato applicare questa migrazione a FreePT di produzione senza un ambiente di staging, test PostgreSQL reali, audit di permessi e procedura di rollback.

## PostgreSQL 16 reale nella CI (database isolato, nessun servizio live)
- Il workflow `.github/workflows/bridge-checks.yml` ha un job aggiuntivo `bridge-postgres` che avvia PostgreSQL 16 in un container **temporaneo di GitHub Actions**, con credenziali locali del job. Non usa URL, segreti, chiavi né dati Supabase/Render reali.
- `bridge/postgres-ci-bootstrap.sql` crea esclusivamente ruoli e identità fittizie per le funzioni Bridge, senza importare lo schema completo dell'app FreePT. La CI applica le cinque migrazioni isolate esistenti: foundation, owner controls, device verifiers, audit e jobs staging.
- `bridge/postgres-ci-tests.sql` esegue **vere chiamate PostgreSQL** per verificare i permessi, l'accodamento, il claim, il completamento, il rifiuto di un binding errato, il replay, la revoca, il regrant e lo switch OFF. I ruoli `anon` e `authenticated` non possono invocare le funzioni riservate o manipolare `bridge_jobs`.
- `bridge/postgres-ci-concurrency.sh` crea **due connessioni PostgreSQL concorrenti**: una mantiene il lock `FOR UPDATE` sulla riga dispositivo e poi disattiva Bridge; l'altra tenta il claim e deve fallire per `lock_timeout`, quindi fallire nuovamente con `bridge_unavailable` dopo lo spegnimento.
- GitHub Actions run `42283799587`: job Node **141/141 test superati**, job PostgreSQL **migrations + lifecycle + concorrenza superati**. Nel log appaiono `bridge-postgres-contract-ok` e `bridge-postgres-concurrent-owner-off-ok`.
- **Perimetro del risultato:** è PostgreSQL reale ma **non Supabase reale**; l'ambiente simula il minimo necessario di `auth.uid` e `profiles`, non tutte le policy, estensioni o interazioni della FreePT attuale. La concurrency prova il blocco della riga dispositivo rispetto allo spegnimento, non tutte le possibili interleaving di grant/revoke/profiles, né failover distribuito. Resta da collegare il backend alle RPC SQL con identificazione sicura del TX, persistenza delle sessioni, fencing, cancellazione lavori e gestione errori e da collaudare tutto su staging dedicato prima di parlare di produzione.

## Adattatore backend PostgreSQL (solo prototipo)
- `bridge/postgresJobsAdapter.mjs` aggiunge `BridgePostgresJobsAdapter`, un componente **esclusivamente server-side** che utilizza un client RPC fidato iniettato dal backend. Prima di `bridge_server_enqueue_list` verifica l'amministratore tramite `authenticateAdmin`; prima di `bridge_server_claim_list` e `bridge_server_complete_list` verifica e lega la sessione TX tramite `BridgeDeviceSessionGate.getDispatchBinding`. Identificativi UUID e risposte RPC sono validati e gli errori fanno fallire l'operazione senza ripiegare sulla coda locale.
- Otto nuovi test `bridge/postgresJobsAdapter.test.mjs` verificano chiamate a funzione e argomenti esatti, admin non approvato, token TX invalidi, coda vuota, risposte malformed, errori e dipendenze obbligatorie. Nessuna credenziale o URL reale è presente nei sorgenti.
- GitHub Actions run `42284396363` (commit `8840aac7cd7d9972f9e97f86dbb5c2eaa6e39a21`): **149 test Node.js su 149 superati**; PostgreSQL 16 isolato, installazione migrazioni, controllo permessi, ciclo lavori e test di concorrenza superati.
- **Limiti attuali:** il test dell'adattatore usa un client RPC simulato, mentre i test PostgreSQL chiamano direttamente le funzioni SQL; non è ancora stato verificato il percorso Node adapter → client RPC reale → PostgreSQL. L'adattatore non espone `connectDevice`, cancellazione o stato del lavoro, non è collegato al server HTTPS né all'Android TX. `BridgeDeviceSessionGate` rimane in memoria: per multiistanza servono sessioni persistenti/revocabili e binding verificato sul backend. Non usare in produzione.

## Test di integrazione Node.js → PostgreSQL 16 temporaneo
- `bridge/postgresJobsLive.integration.mjs` esercita il **vero** `BridgePostgresJobsAdapter` tramite un mini-client RPC locale solo per test, basato sul comando `psql` e un elenco fisso di tre funzioni. Si collega esclusivamente a `PGDATABASE=bridge_test` nella CI GitHub: senza questo database fittizio rifiuta l'esecuzione.
- La CI applica le migrazioni su PostgreSQL 16 temporaneo, svolge prima i test SQL e di concorrenza, poi invoca `node --test bridge/postgresJobsLive.integration.mjs`. I dati precedenti del fixture SQL sono esclusi dalle code del nuovo test per non alterare l'ordine FIFO. Nessuna chiave o URL di Supabase/Render viene letta.
- Il test verifica che l'amministratore non autorizzato sia rifiutato, che un lavoro sia creato e completato con stato `done` persistito, che un token TX errato sia rifiutato, che una seconda completion non riesca e che una **revoca effettiva nel database** blocchi un nuovo accodamento anche quando la copia locale del registro rimane obsoleta.
- GitHub Actions run `42285288611` (commit `11564f010350c462095cec9c5e7805633391a790`): **149/149 test Node.js superati**, **1/1 test di integrazione Node–PostgreSQL superato**, migrazioni SQL e test concorrenza superati, zero fallimenti.
- **Ambito preciso:** il mini-client `psql` è soltanto uno strumento di prova, non il client Supabase RPC di produzione. Le credenziali TX sono in memoria nel fixture, il database è temporaneo e utilizza identità fittizie. Resta necessario testare su uno staging Supabase effettivo, integrare un client RPC server-side protetto, implementare sessioni condivise e protezioni anti-replay multiistanza, oltre a completare cancellazione e stato dei job prima di una distribuzione reale.

## Stato e cancellazione lavori PostgreSQL (staging isolato)
- `supabase/migrations/20261106_bridge_job_admin_staging.sql` è **additiva** rispetto a `bridge_jobs_staging.sql` e contiene soltanto `bridge_server_job_status(uuid,uuid)` e `bridge_server_cancel_job(uuid,uuid)`. Entrambe le funzioni sono `security invoker` e richiedono `service_role`; le autorizzazioni `PUBLIC`, `anon` e `authenticated` sono revocate.
- La coppia `jobId/receiverId` è verificata nel database. Il `receiverId` non arriva dal dispositivo né dal corpo HTTP: `BridgePostgresJobsAdapter` lo ottiene dall'autenticazione admin server-side. Le due funzioni bloccano prima il dispositivo e poi la riga del lavoro, preservando l'ordine dei lock usato da claim e completion.
- Lo stato viene restituito come JSON minimo `{jobId,deviceId,state}`; la cancellazione modifica lavori `queued` o `sent` in `cancelled`, azzera il binding di sessione TX e impedisce completamenti successivi. Un lavoro `done` o già `cancelled` non è cancellabile di nuovo. Il richiedente può consultare o annullare il proprio lavoro anche dopo la revoca, ma non può crearne uno nuovo: questa è una distinzione intenzionale tra gestione del lavoro e accesso al TX.
- `bridge/postgresJobsAdapter.mjs` fornisce ora `getRequestStatus` e `cancelRequest` oltre a `requestList`, `pollDevice`, `completeDevice`; non usa lo stato `BridgeRegistry` per queste operazioni. Sono stati aggiunti quattro test Node sulle nuove RPC e un test SQL PostgreSQL con job fittizi, autorizzazioni incrociate, revoca e stati finali. Il test end-to-end `bridge/postgresJobsLive.integration.mjs` richiama ora anche stato/cancellazione sul PostgreSQL temporaneo.
- GitHub Actions run `42287372992`: **153/153 test Node superati**; migrazioni PostgreSQL, flusso dei lavori, test SQL `bridge-postgres-admin-jobs-ok`, concorrenza e integrazione Node → PostgreSQL superati. La verifica è su database fittizio di CI, non su Supabase reale.
- La funzione di revoca proprietario già presente aggiorna il grant ma non cancella automaticamente tutti i lavori persistenti preesistenti; l'assegnazione di lavori revocati resta impedita dal controllo di consenso. Restano da progettare invalidazione di lavori sent durante la revoca, gestione della presenza/sedute TX su più istanze, scadenze e pulizia della coda. Gli errori SQL vengono ancora riportati genericamente dall'adattatore come indisponibilità e richiedono un mapping controllato prima di uno staging HTTPS.

## Fencing permanente dei lavori su revoca e spegnimento (staging)
- La migrazione **additiva** `supabase/migrations/20261106_bridge_job_revocation_fence.sql`, applicata dopo lo schema dei lavori, aggiunge due trigger PostgreSQL. Alla transizione di `bridge_grants.revoked_at` da NULL a un valore impostato, annulla tutti i lavori `queued` e `sent` della coppia dispositivo/ricevente. Alla transizione dello switch `bridge_devices.bridge_enabled` da TRUE a FALSE, annulla tutti i lavori `queued` e `sent` del dispositivo.
- L'aggiornamento è parte **della stessa transazione** del cambio di consenso; il binding della sessione TX viene cancellato, mentre i lavori `done` restano invariati. Una nuova autorizzazione o riaccensione del dispositivo non riporta in vita i lavori già annullati: serve una richiesta nuova.
- Il test `bridge/postgres-ci-revocation-fence.sql` esegue realmente su PostgreSQL 16 le sequenze `sent/queued → revoca → regrant` e `sent/queued → OFF → ON`, verifica che i vecchi lavori non siano completabili/assegnabili e che i lavori nuovi continuino a funzionare. La suite `postgres-ci-admin-jobs.sql` è stata aggiornata alla nuova semantica di annullamento automatico.
- GitHub Actions run `42290430308`: **153/153 test Node.js superati**, test PostgreSQL di revoca, permessi, stato/cancellazione, concorrenza e adattatore Node→PostgreSQL superati senza fallimenti. `supabase/bridge_preflight.sql` controlla anche la presenza e l'abilitazione dei due nuovi trigger.
- **Limiti ancora aperti:** il percorso funziona sul PostgreSQL temporaneo della CI, non su Supabase di staging o produzione. Le modifiche dirette tramite `service_role` che aggirano l'ordine device→grant lock, le variazioni di `profiles.status` non serializzate e le sessioni TX multiistanza non sono ancora protette integralmente; non pubblicare il servizio fino a quando tali flussi non sono completati e verificati. I trigger impediscono la riattivazione di un lavoro persistito, non cancellano azioni già fisicamente eseguite da un TX prima della revoca.

## Sessioni TX persistenti PostgreSQL (modello di staging isolato)
- `supabase/migrations/20261106_bridge_tx_sessions_staging.sql` aggiunge `bridge_tx_sessions` con una sola sessione corrente per dispositivo, impronta SHA-256 del token, impronta del verificatore della credenziale TX, creazione e scadenza. Nessun segreto grezzo TX viene salvato nel database; RLS attiva, nessuna policy client, RPC invocabili soltanto dal backend con `service_role`.
- Le funzioni `bridge_server_open_tx_session`, `bridge_server_assert_tx_session` e `bridge_server_close_tx_session` gestiscono rispettivamente sostituzione atomica della sessione precedente, verifica corrente con scadenza del server e chiusura esplicita. Un nuovo collegamento annulla anche i lavori persistenti `sent` del dispositivo. Tutte le operazioni bloccano `bridge_devices` con `FOR UPDATE`, per rispettare il protocollo delle revoche del proprietario.
- Due trigger su `bridge_devices` e `bridge_device_verifiers` eliminano la sessione alla disattivazione Bridge e quando il verificatore o il sale della credenziale cambiano o sono cancellati. Una successiva riattivazione non fa rinascere il token precedente. Le autorizzazioni amministrative e le code persistenti restano separate.
- `bridge/postgres-ci-tx-sessions.sql` prova realmente su PostgreSQL 16: rifiuto di verificatore errato, TTL cinque minuti, token sostituito alla riconnessione, invalidazione dei lavori consegnati, scadenza, rotazione delle credenziali, OFF/ON e chiusura. GitHub Actions `42295698657`: **153/153 test Node.js** e test PostgreSQL TX superati, insieme agli altri test SQL e di concorrenza.
- `supabase/bridge_preflight.sql` include controlli read-only per tabella, RLS, permessi backend e trigger di invalidazione.
- **Integrazione ancora da completare:** `BridgeDeviceSessionGate` e `BridgePostgresJobsAdapter` usano ancora le sessioni **in memoria** nei loro percorsi Node; le nuove RPC SQL non sono state collegate a un autentificatore TX server-side con verificatori persistiti. La verifica della sessione deve inoltre essere resa atomica con la modifica dello stato dei job su PostgreSQL per evitare una finestra di riuso tra verifica e claim/completion. Questi test riguardano le funzioni SQL su un database CI temporaneo, non un servizio multiistanza distribuito né Supabase o Android reali. Il verificatore fornito alla RPC da un client non trusted non dimostra il possesso del segreto: l'identità del TX va accertata prima da un backend fidato.

## Stato
Scaffold admin nel ramo di lavoro: pulsante Bridge e schede Approvazioni/File, senza backend Bridge, senza implementazione nativa e senza accesso remoto. Ogni eventuale collegamento presentato in UI deve essere fondato su dati server reali.
