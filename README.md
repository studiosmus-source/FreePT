# FreePT

FreePT è una chat privata con richiesta di accesso. L'utente inserisce nome e cellulare, accetta il disclaimer, invia la richiesta e attende una decisione. Non deve inserire password o verificare il telefono tramite SMS.

## Esperienza utente

- Prima apertura: modulo con nome, telefono e accettazione obbligatoria del disclaimer.
- Richiesta inviata: «I nostri sistemi stanno elaborando la tua richiesta di accesso… Attendere.»
- Approvazione amministratore: la chat si apre al successivo controllo dello stato (ogni 20 secondi con app visibile).
- Rifiuto: la chat resta bloccata e l'app mostra la schermata di accesso con richiesta non approvata.
- Invio messaggi/allegati: dopo la conferma del server compare «Richiesta in elaborazione… Attendere.» finché non arriva la risposta nella stessa chat.
- Amministratore: elenco utenti, pulsanti Approva e Rifiuta per le richieste in attesa, chat singole.
- **Non ci sono notifiche push quando l'app è chiusa**. L'approvazione è rilevata quando l'app è aperta o torna in primo piano.
- Con l'app aperta, i messaggi sono ricontrollati circa ogni 6 secondi anche se gli eventi realtime non arrivano.
- L'utente non ha il pulsante «Esci»: la sessione anonima deve rimanere associata all'installazione. Solo l'amministratore può effettuare il logout.
- Le richieste pending o rifiutate non aprono la chat nella lista amministrativa.

## Identità tecnica e limiti

Il telefono è una dichiarazione, non una verifica del possesso del numero. Per mantenere le chat separate, Supabase crea internamente una sessione anonima associata ai dati dell'installazione. Non esiste login utente con nome/telefono: se l'app viene disinstallata o i dati vengono cancellati, si può perdere l'accesso alla conversazione precedente. Non utilizzare con dati reali prima del collaudo completo dell'isolamento delle chat e degli allegati.

## Accesso amministratore biometrico (APK di test)

L'amministratore mantiene un'identità **Supabase Auth** con email e password per l'attivazione iniziale. Finché tale sessione resta valida, la nuova versione APK usa il riconoscimento biometrico **nativo Android** per sbloccare l'area amministrativa all'avvio e quando l'app torna in primo piano. Non salva o legge impronte digitali.

Il plugin `@capgo/capacitor-native-biometric` versione 7 è associato a Capacitor 7; il workflow Android aggiunge il permesso `USE_BIOMETRIC` durante la generazione del progetto. Se il telefono non ha biometria disponibile, lo sblocco è bloccato nella nuova versione: non distribuire senza collaudare questa situazione e predisporre il recupero dell'account. La verifica biometrica è **solo uno sblocco locale della sessione**: non sostituisce la verifica di identità sul server. Per un login realmente senza password serve la futura integrazione di passkey/WebAuthn lato Supabase, che non è stata implementata.

**Non ancora testato su dispositivo** e non va presentato come pronto finché GitHub Actions non produce la nuova build e si verifica l'impronta su Android.

## Configurazione Supabase richiesta prima del test reale

1. Il progetto deve contenere lo schema originale `supabase/schema.sql` (non rieseguire ciecamente operazioni già applicate).
2. Applicare la migrazione `supabase/migrations/20261105_access_requests.sql` nel SQL Editor e confermare che non abbia errori.
3. In Authentication abilitare **Anonymous Sign-ins**. Non è necessario abilitare **Phone signups**, conferme via SMS o provider SMS a pagamento.
4. Creare **separatamente** l'identità amministratore tramite Supabase Authentication, con email e password affidabili. Verificare l'ID in `auth.users`, creare o associare il corrispondente profilo in `public.profiles` e assegnare `role='admin', status='approved'` soltanto a quell'ID. Il profilo amministratore **non** va ottenuto dalla richiesta anonima di un utente.
5. Fare test con due dispositivi/sessioni distinti: richiesta, approvazione, rifiuto, invio e ricezione, RLS e Storage. Verificare il comportamento dopo riavvio app e cambio rete.

**Attenzione:** i passaggi Supabase non sono stati eseguiti né verificati da questa repository. L'APK può compilare correttamente ma la richiesta di accesso fallire finché non vengono completati.

## Collaudo completato e modalità TEST rimossa

Nel collaudo su un solo telefono, l'utente ha confermato il funzionamento di richiesta e approvazione, chat bidirezionale, allegati e apertura della galleria senza perdere la sessione amministrativa.

La modalità temporanea a schermo diviso, con il pulsante TEST e la seconda sessione Supabase, è stata rimossa dai sorgenti. La chat normale mantiene il caricamento di allegati (limite 25 MB), il nome del file scelto, il permesso biometrico e la sospensione del blocco durante la selezione di foto/documenti.

Le righe di prova eventualmente create in Supabase non vengono cancellate da questa modifica, per evitare alterazioni involontarie del database. Il funzionamento con due installazioni fisiche separate non è ancora stato verificato.

## Gestione chat: pressione lunga (solo amministratore)

Dalla lista chat, tenere premuta una conversazione per circa 650 ms (oppure usare il menu contestuale con il mouse). Si apre una finestra con conferme esplicite:

- **Cancella chat:** elimina i messaggi della conversazione e i relativi allegati; mantiene l'utente approvato. La chat sparisce dalla lista fino a quando l'utente non scrive di nuovo.
- **Elimina utente:** elimina gli allegati tramite la Storage API e poi cancella l'identità Supabase Auth; la rimozione del profilo e dei messaggi avviene con i vincoli di cascata del database. La persona dovrà effettuare una nuova richiesta se vuole tornare.
- **Annulla:** chiude il menu senza modifiche.

Questi comandi sono visibili **soltanto all'amministratore** autenticato e la RPC verifica sul server il ruolo admin approvato, senza potersi applicare all'admin stesso. Non sono concessi permessi DELETE diretti sulle tabelle all'app. I file sono cancellati tramite Storage API con una policy dedicata: non cancellare mai direttamente righe in `storage.objects`.

### Migrazione obbligatoria

Prima di installare la nuova APK, eseguire una volta in **Supabase SQL Editor** il file `supabase/migrations/20261105_delete_chats_users.sql`. Aggiunge `profiles.chat_hidden_at`, la policy di eliminazione dei file per l'admin e la RPC `freept_admin_delete_conversation`. L'esecuzione della migrazione **non cancella alcun dato**. Se non è stata eseguita, la nuova APK potrebbe non riuscire a caricare l'elenco chat.

Prima di rimuovere gli allegati, l'app verifica sul server tramite `freept_delete_ready()` che la migrazione sia installata e che il richiedente sia l'amministratore approvato. Se la migrazione manca, la chat normale resta utilizzabile, ma la cancellazione non parte.

Le operazioni sono irreversibili. Gli allegati sono eliminati prima delle righe SQL: se il processo fallisce a metà, alcuni file possono essere già stati eliminati anche se la chat è ancora presente. Evitare operazioni contemporanee sulla stessa chat. Non è stata verificata l'esecuzione SQL nel progetto Supabase remoto né il collaudo di queste cancellazioni su Android; provarle prima su un account fittizio.

## Caricamento di foto e allegati su Android

Per file fino a **6 MB** FreePT usa il caricamento Supabase Storage gia' collaudato. Per file oltre 6 MB e fino al limite di **25 MB**, ora usa il caricamento riprendibile TUS con blocchi da 6 MB, tentativi automatici e percentuale di avanzamento. Nessuna foto viene ridimensionata o ricodificata. Si conserva la stessa sessione Supabase anonima per gli amici e la stessa policy RLS del bucket privato `attachments`.

Questo cambio e' stato introdotto per migliorare l'affidabilita' su connessioni mobili, **non** sulla base di un errore remoto acquisito: l'assenza di un messaggio dal telefono dell'amico non consente di dimostrare che sia questa la causa. Verificare su una APK compilata che funzionino foto piccole, foto oltre 6 MB, documenti, profili approvati e l'invio di messaggi dopo il caricamento. Il blocco puo' dipendere anche dal selettore Android, dai permessi, da un limite Storage globale o dalla rete.

## APK Android

Il workflow GitHub `.github/workflows/android-debug.yml` genera un APK di debug e verifica archivio, identificativo `it.freept.app` e hash. Dopo ogni modifica controllare l'esito della nuova build: una vecchia compilazione verde non prova che la nuova versione funzioni.

## Notifiche push Android (ramo sperimentale `feature/push-notifications`)

**Stato:** sorgenti predisposti, NON attivo nel progetto Supabase e NON distribuito nell'APK su `main`. Finche' manca la configurazione dei servizi esterni, la versione Android funzionante resta quella di `main`. Il codice non espone chiavi di servizio nell'app.

### Comportamento previsto

- Le notifiche sono bidirezionali: quando un amico approvato scrive, si avvisa l'amministratore; quando l'amministratore risponde, si avvisa soltanto il dispositivo dell'amico.
- La notifica mostra solo **FreePT — Hai un nuovo messaggio**. Non contiene testo, nomi o allegati.
- Il dispositivo Android chiede una volta l'autorizzazione alle notifiche quando l'utente entra in una chat approvata; un rifiuto viene rispettato.
- La registrazione FCM usa Supabase Auth esistente; i token sono protetti da RLS e non leggibili da altri account.
- Le notifiche si ricevono anche quando l'app non e' in primo piano, **dopo il collaudo** e quando Android/Google Play Services lo consentono. Il tocco apre l'app, mantenendo lo sblocco biometrico per l'amministratore.
- Non vengono aggiunti servizi IA, abbonamenti ChatGPT/Claude o SMS. Firebase FCM ha disponibilita' e quote proprie.

### Attivazione — passaggi obbligatori

1. Creare un progetto [Firebase Console](https://console.firebase.google.com/) e registrare una app **Android** con identificatore **`it.freept.app`**.
2. Scaricare dal progetto Firebase **`google-services.json`**, assicurandosi che il package sia esatto. NON inserirlo nel repository. Aprirlo con un editor di testo e copiare tutto il contenuto JSON nel segreto **GitHub Actions → Secrets and variables → Actions** chiamato `FREEPT_GOOGLE_SERVICES_JSON` (non occorre Base64). La build sul ramo push fallisce esplicitamente se manca.
3. Abilitare l'API **Firebase Cloud Messaging HTTP v1** e generare una credenziale **Firebase service account** destinata solo all'invio server. NON inserire il JSON della chiave in GitHub e non condividerlo in chat. In Supabase **Edge Functions → Secrets** configurare `FCM_SERVICE_ACCOUNT_JSON` con il contenuto JSON completo.
4. Generare una stringa casuale privata lunga per `FREEPT_WEBHOOK_KEY` e salvarla **solo nei Secrets Supabase**; servira' anche nel database webhook come header `x-freept-webhook-key`. Non scrivere la chiave nel codice.
5. Eseguire in Supabase SQL Editor la migrazione **`supabase/migrations/20261105_push_devices.sql`**. Crea una nuova tabella con RLS; NON elimina utenti, chat o documenti.
6. Distribuire la Edge Function **`freept-push`** da questo ramo usando Supabase CLI/integrazione delle funzioni. In `supabase/config.toml`, `verify_jwt=false` e' intenzionale per il webhook: la funzione verifica il segreto privato nell'header.
7. In **Supabase Dashboard → Database → Webhooks** creare un webhook sullo schema `public`, tabella `messages`, evento **INSERT**; destinazione Edge Function `freept-push`, metodo POST, header `x-freept-webhook-key` con il valore segreto del punto 4. Non far inviare eventi di UPDATE/DELETE.
8. Avviare manualmente il workflow **Build Android APK** scegliendo il ramo `feature/push-notifications`, e verificare la build con il vero `google-services.json`. Non installare una APK di un altro ramo per verificare le notifiche.
9. Collaudare **due installazioni Android distinte**, con permessi notifiche concessi: amico → admin app chiusa, admin → amico app chiusa; ripetere in background, con file allegato, con accesso negato e dopo riavvio. Controllare i log della Edge Function e la tabella `push_devices` senza pubblicarne i token.

**Sicurezza:** la funzione controlla il segreto webhook, rilegge il messaggio dal DB, verifica che mittente e destinatari siano approvati e invia solo ai token dei destinatari. La chiave privata Firebase non e' mai richiesta dall'APK. Le righe `push_devices` sono rimosse quando un profilo utente viene eliminato (FK CASCADE). Le notifiche Android possono essere limitate da batteria, restrizioni del dispositivo o diniego dell'autorizzazione.

**Limite del collaudo:** la sintassi JS potra' essere verificata staticamente ma la consegna di push reali NON e' stata verificata; senza i tre elementi (Firebase Android, credenziali server, webhook) non puo' funzionare.
