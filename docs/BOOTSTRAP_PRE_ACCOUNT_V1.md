# Protocollo Bridge pre-account v1 — solo ambiente isolato

Non abilitato o distribuito in produzione. I test automatici non equivalgono al collaudo Android reale. Nessuna identità tecnica crea un account personale Supabase.

## Autorizzazione

1. Prima di nome/telefono il Chieditore verifica File, Notifiche e Batteria, una voce per volta. Usa il plugin File esistente; dopo ogni Activity ricontrolla lo stato effettivo. Il controllo notifiche non chiama `register()` e non salva token push. ColorOS non interrogabile resta «non verificabile».
2. Con l'azione esplicita Continua su Bridge il nativo genera una coppia P-256 nel Keystore Android. La chiave privata non esce dal Keystore. UUID tecnico e codice casuale da 48 bit restano nelle preferenze private; il codice è mostrato soltanto sul dispositivo, non nei rapporti.
3. `/start` riceve SPKI e consenso con prova firmata dalla chiave corrispondente. Crea solo una richiesta tecnica pending. Nessun amministratore è selezionato automaticamente. Nessun job o file personale disponibile.
4. L'admin autenticato apre Bridge e inserisce il codice letto sul dispositivo consenziente, poi preme Autorizza dispositivo. Il server ricontrolla Supabase Auth e ruolo/status nella tabella profiles; SQL ricontrolla e blocca la riga. Il codice è monouso, scade dopo 15 minuti e viene memorizzato solo come hash. La risposta admin contiene l'ID tecnico da conservare per l'eventuale revoca. Non autorizzare codici ricevuti da soggetti/dispositivi non riconosciuti.
5. Lo stesso `BridgeTxService` riceve un job remoto `diagnostic`. Genera 300.000 byte sintetici derivati dalla challenge casuale del server e invia due blocchi, uno da 262.144 byte. Il server confronta ogni byte atteso, controlla gli offset sotto lock e verifica il completamento. Il nativo controlla dimensioni, ack e SHA256. Non ci sono handle, percorsi o letture di foto/documenti in questa corsia.
6. Solo lo stato server verified, con hash corrispondente e servizio/permesso effettivamente attivi, abilita il passaggio a nome/telefono. Chiudere un tentativo fallito esce dalla diagnostica e ferma TX; non apre la registrazione. Il rapporto JSON locale si condivide soltanto manualmente e usa campi ammessi.
7. La registrazione personale resta quella esistente. Alla successiva approvazione personale, `/claim` richiede contemporaneamente prova della stessa chiave e token Supabase dell'account approved. La prova include l'hash del token per impedire lo scambio dell'identità personale nell'envelope. Una transazione crea il dispositivo/verifier/grant nei modelli Bridge esistenti, con l'esatto admin che aveva autorizzato il codice. Nessuna grant a tutti gli admin. Nessuna promozione durante lo stato pending.
8. Il segreto legacy viene generato e cifrato nativamente prima di claim, così un retry dopo perdita dell'ack riusa gli stessi dati. Non viene restituito a JS. Il servizio passa al protocollo legacy solo dopo la conferma di binding. Se occorre riprendere una diagnostica dopo un errore, non viene ricreata la registrazione personale.

## Prova firmata e replay

Envelope: deviceId, timestamp in millisecondi, nonce casuale 128 bit, payload JSON serializzato come stringa, firma DER ECDSA-SHA256 in Base64. Messaggio firmato UTF-8:

```
freept-bootstrap-v1
<azione>
<deviceId>
<timestamp>
<nonce>
<payload esatto>
```

Il gateway ammette soltanto SPKI P-256, formato/campi limitati e scostamento orologio di 60 secondi. Il database registra nonce con chiave univoca per dispositivo nella stessa transazione dell'operazione: un replay riuscito non può ripetere una mutazione. I nonce oltre due minuti sono rimossi perché i relativi envelope sono già scaduti. I job sintetici completati scadono dopo 24 ore prima del binding. Un dispositivo scaduto o revocato richiede una nuova approvazione amministratore; nessun bypass automatico.

## Database e confini

Due sole nuove tabelle: `bridge_bootstrap_devices`, `bridge_bootstrap_nonces`. RLS attiva, nessuna concessione diretta ad anon/authenticated. Funzione `bridge_bootstrap_step` SECURITY INVOKER, search_path vuoto, EXECUTE solo service_role. Il service key resta nel gateway, mai nell'APK. Nessun SECURITY DEFINER pubblico nuovo.

Il server verifica la firma prima della funzione privilegiata; SQL non è una seconda implementazione della crittografia. La funzione è quindi riservata esclusivamente al gateway fidato. L'admin autorizzante viene ricontrollato ad ogni operazione; revoca admin/dispositivo, scadenza e modifica dell'owner negano l'operazione. La revoca di un bootstrap già promosso disabilita anche Bridge e revoca le sue grant.

Esiste un limite di 100 richieste pending attive, oltre al rate limit HTTP già presente. Prima di un'esposizione pubblica va verificata anche la protezione anti-abuso del proxy: il limite di inventario non elimina gli attacchi di saturazione. HTTPS terminato dal proxy e origine nativa configurata sono prerequisiti; nessun listener pubblico HTTP diretto deve poter falsificare `x-forwarded-proto`.

## Attivazione isolata

- Backend `httpsStagingServer.mjs`: `FREEPT_BRIDGE_BOOTSTRAP=STAGING_DEVICE_KEY_V1`, oltre ai gate staging preesistenti.
- Frontend: `VITE_BRIDGE_ISOLATED_BUILD=true`, `VITE_BRIDGE_BOOTSTRAP_ENABLED=true`, URL/chiave pubblica di Supabase test e `VITE_BRIDGE_TEST_API_URL` del gateway HTTPS isolato.
- Installatore nativo: target staging e `FREEPT_BRIDGE_BOOTSTRAP=STAGING_DEVICE_KEY_V1`. L'installatore rifiuta l'attivazione bootstrap sul target production prima di scrivere i file generati.
- La composizione production non installa il nuovo handler e la build unificata esistente conserva il gate nativo disabilitato. La build isolata CI usa un hostname `.invalid`, è solo una prova di compilazione e non è un'app configurata per un telefono.

Non cambiare il package/firma della futura APK unificata definitiva per aggirare i limiti. Il package isolato di CI è solo un banco di prova automatico.

## Deploy e rollback

Schema applicato soltanto a FreePT-Bridge-Test, con transazione. La prova SQL con ruolo service_role è contenuta in `supabase/bootstrap/SMOKE_ROLLBACK_STAGING_ONLY.sql` e termina con rollback. Per disattivare un gateway test togliere il gate dedicato; per rimuovere lo schema nuovo dopo aver fermato i test eliminare la funzione e le due tabelle nuove, non le tabelle legacy. Una grant già promossa va revocata esplicitamente prima della rimozione: eliminare le tabelle bootstrap non revoca da solo le grant legacy.

Un eventuale passaggio in produzione richiede analisi di impatto, backup verificato, piano di revoca/rollback delle grant già promosse, gate dedicato e approvazione dell'utente. Non è stato eseguito.
