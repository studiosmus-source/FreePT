# FreePT

FreePT è una chat privata per inviare richieste e allegati al servizio e ricevere risposte. Il proprietario del servizio gestisce tutte le conversazioni; ogni utente vede solo la propria.

## Stato e sicurezza

**Prototipo non collaudato.** Non utilizzare dati personali reali prima di verificare autenticazione, RLS e permessi Storage. Le regole SQL sono in `supabase/schema.sql`; la loro presenza nel repository non ne prova l'applicazione sul progetto remoto.

## Autenticazione con numero e password (senza SMS)

L'app ora usa `supabase.auth.signUp({ phone, password })` e `signInWithPassword({ phone, password })`. Non usa più indirizzi email sintetici: il dominio `.invalid` può essere rifiutato da Supabase.

Sul progetto Supabase devono essere abilitati **Phone provider** e la modalità **senza conferma telefonica**. *Non attivare la conferma tramite SMS e non configurare un provider SMS a pagamento.* Se la configurazione hosted non consente di usare Phone+Password senza invio di SMS, occorre sostituire il flusso con una procedura di registrazione amministrata lato server **prima del rilascio**; non aggirare la verifica utilizzando indirizzi email inventati.

Il numero non è verificato via SMS e deve essere trattato come dichiarazione dell'utente. L'approvazione amministrativa è separata dall'autenticazione.

## Amministratore

Dopo aver creato il primo account e verificato la sua identità, l'assegnazione del ruolo `admin` va eseguita mediante il SQL Editor con una query puntuale sull'ID corretto. **Non** promuovere un account sulla base del solo numero dichiarato da una persona sconosciuta.

## Android

Il workflow `.github/workflows/android-debug.yml` prova a costruire un APK di debug tramite GitHub Actions. La presenza del workflow non significa che una build abbia avuto successo. Conservare il file di build e i log per verificare il risultato prima di distribuire l'app.
