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
- Snapshot e ripristino sono gestiti dal modello in memoria; è disponibile anche `bridge/localSnapshotStore.mjs`, adattatore di prova su file locale. Non esiste ancora persistenza condivisa di produzione, endpoint autenticato o migrazione Supabase. Il filesystem Render non è un database affidabile.
- Al ripristino `online` torna `false`, nessun job pendente viene ripristinato e ogni dispositivo deve riconnettersi e autenticarsi al backend.
- La funzione di ripristino deve accettare esclusivamente dati già validati dal server e provenienti da un archivio attendibile. Non usarla direttamente con input dell'utente.
- Il prototipo JS non è un sistema di autenticazione: autorizzazioni e revoca richiedono verifica lato backend anche durante stream/trasferimenti in corso.
- Sono presenti dieci test del modello e sei test dell'archivio locale. Non è ancora confermato l'esito del workflow CI del repository.

## Stato
Scaffold admin nel ramo di lavoro: pulsante Bridge e schede Approvazioni/File, senza backend Bridge, senza implementazione nativa e senza accesso remoto. Ogni eventuale collegamento presentato in UI deve essere fondato su dati server reali.
