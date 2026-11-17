# FreePT Bridge v2 — ricostruzione isolata (17/11/2026)

**Origine verificata**: repository `studiosmus-source/FreePT`, branch `main`, commit `84b7dd0bf0b0863d148fa7c85a3f10a71d67b90c`.
Il repository NON contiene il vecchio Bridge visibile negli screenshot: la presente implementazione è nuova, non è un recupero compatibile garantito delle vecchie chiavi o del vecchio backend.

## Funzionamento previsto
- La chat rimane invariata (testo «Richiesta in elaborazione» incluso).
- L'utente approvato apre **Attiva file**, sceglie esplicitamente tramite Android Storage Access Framework una cartella e le relative sottocartelle, e può disattivare il Bridge e revocare il permesso.
- Il dispositivo viene associato al suo `auth.uid()` FreePT (non al solo nome o telefono dichiarato).
- L'amministratore autenticato apre la chat dell'utente, poi **File e cartelle**, e può esplorare la cartella consentita e scaricare file a blocchi.
- Funziona tramite richieste al database Supabase con RLS, senza richiedere che i telefoni condividano una rete locale.
- **Limite attuale**: FreePT deve essere aperto in primo piano sul dispositivo remoto; non è implementato un servizio Android permanente in background. Download massimo 25 MB, cartelle massimo 1000 elementi, file e cartelle accessibili solo nella cartella scelta.
- **Non** è implementato il download ricorsivo di cartelle intere o la ripresa automatica di trasferimenti interrotti.
- Le due chiavi precedenti TX/RX non vengono usate né richieste dall'utente remoto. Il loro formato e l'algoritmo precedente non sono disponibili; non vanno inventati. La sicurezza del nuovo Bridge deriva dall'identità Supabase, dall'approvazione admin, RLS e consenso Android.
- Il server conserva temporaneamente negli esiti delle richieste anche i blocchi base64 dei file. Per privacy e costi va implementato/attivato un job di pulizia periodico prima dell'uso reale.

## Prerequisiti per il collaudo
1. Verificare lo stato reale del progetto Supabase (tabelle, policy, indici, limiti e accessi), e fare backup; **non** applicare alcuna migrazione senza questo confronto.
2. In ambiente TEST, applicare `supabase/migrations/20261117_bridge_v2.sql` dopo le migrazioni FreePT esistenti. La migrazione è additiva e non cambia i messaggi.
3. Compilare tramite `.github/workflows/android-debug.yml` e verificare l'APK risultante (packaging `it.freept.app`).
4. Testare con due account Android reali e un account admin separato: attivazione, registrazione, elenco, apertura sottocartelle, scaricamento, revoca, cambio rete, chiusura app, timeout, installazione di aggiornamento senza perdita sessione.
5. Ispezionare i permessi Supabase con un utente non amministratore: impossibilità di enumerare dispositivi altrui, inserire richieste come admin, rispondere per altri, accedere a un file fuori dalla cartella SAF.
6. Implementare pulizia periodica `bridge_requests` scadute; con backup e log.
7. Solo dopo questi test valutare produzione e unire il ramo.

## Diagnosi della vecchia app
Le foto mostrano (1) sul telefono dell'utente «Non è stato possibile attivare: registrazione del telefono»; (2) sul telefono admin «Nessun telefono Bridge autorizzato per questa persona». Non dimostrano quale chiamata del vecchio backend fallisca; la diagnosi precisa richiede i sorgenti/l'APK precedente o i log di rete.

## Stato
Implementazione nuova in ramo di lavoro; nessun SQL remoto eseguito. Verificare build GitHub Actions e test funzionali prima di distribuirla.
