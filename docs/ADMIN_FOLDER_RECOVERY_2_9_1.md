# FreePT TEST 2.9.1-admin — download cartelle numerose

Richiesta: alcune miniature funzionano nella 2.9.0-admin, ma scaricando intere
cartelle numerose l'utente riscontra timeout. Questa patch conserva le miniature.
Base applicativa: `9e83aba19a52df5b7356c635fcb3ccb67084ab3a`.
Solo ricevitore amministratore; nessun aggiornamento al telefono utente,
TX, permessi, catalogo remoto, backend, database o canale OTA.

## Riscontri dai sorgenti, non diagnosi del telefono

- Ogni blocco interrompeva l'attesa dopo 60 controlli × 700 ms (circa 42 s),
  prima della scadenza remota dei job da 60 s. Non era un limite complessivo
  di durata della cartella.
- Il primo errore di rete durante lettura dello stato o recupero dei byte
  terminava il trasferimento, senza recupero dello stesso job.
- Un timeout non cancellava il job noto, che poteva rimanere nella coda TX.
- Un errore diverso dall'annullamento esplicito eliminava tutta la cartella
  temporanea, inclusi file già completati.
- Non sono disponibili log del tentativo sul dispositivo: non si afferma
  che un singolo punto sia la causa confermata del problema segnalato.

## Correzioni

- Attesa di ciascun job allineata a 75 s / massimo 110 controlli, senza
  limite complessivo alla durata del download della cartella.
- Stato e byte di un job già noto ritentati al massimo tre volte su soli
  errori di trasporto/5xx/429/timeout HTTP. Mai retry per accesso revocato,
  autenticazione, dati non validi, corruzione o problemi di spazio locale.
- Job scaduti o esplicitamente cancellati possono rileggere lo stesso
  intervallo. Un job in timeout viene sostituito solo dopo annullamento
  confermato; una risposta incerta all'accodamento non viene ripetuta
  automaticamente.
- Ogni richiesta HTTP è limitata a 20 s ed è annullabile dall'interfaccia.
- Dopo l'esaurimento dei recuperi automatici la cartella resta in pausa.
  «Riprendi dal file interrotto» ritenta il file corrente: i file precedenti
  non vengono riscaricati. Un file corrente parziale è scartato e ricomincia.
- «Interrompi download» conserva esclusivamente i file già completati in una
  cartella esplicitamente parziale; un errore di trasporto senza interfaccia
  può fare lo stesso se il chiamante abilita l'opzione. Mai dichiarare un
  download parziale come cartella completa.
- Durante la pausa le miniature restano sospese e il pulsante Interrompi
  resta disponibile.

## Limiti e verifica

La ripresa è nella stessa sessione aperta dell'app, non dopo chiusura forzata,
riavvio del telefono o terminazione del processo Android. Non è un servizio
Android autonomo in background e non tiene acceso lo schermo. Per il collaudo,
tenere FreePT in primo piano e lo schermo acceso su entrambi i telefoni.
I limiti del TX, dell'autorizzazione e del protocollo esistenti rimangono.
Un telefono offline o un accesso revocato non possono essere corretti dall'APK RX.

Test con trasporto simulato: 1.200 file e durata logica oltre 15 minuti;
risposta TX oltre i vecchi 42 s; errori su stato/byte; timeout/cancellazione
confermata; risposta incerta all'accodamento; ripresa al file interrotto,
salvataggio parziale e revoca. Questi test non sono prove su due telefoni reali.

Build firmata manuale: package `it.freept.bridge.next`, versionCode 21,
versionName `2.9.1-admin`. Installare SOLO sull'amministratore sopra la versione
TEST esistente, senza disinstallare. Nessuna release né distribuzione OTA.
