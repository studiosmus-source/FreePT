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

## Stato
Scaffold admin nel ramo di lavoro: pulsante Bridge e schede Approvazioni/File, senza backend Bridge, senza implementazione nativa e senza accesso remoto. Ogni eventuale collegamento presentato in UI deve essere fondato su dati server reali.
