# Collaudo fisico Oppo/ColorOS e destinazione SAF

**Protocollo preparato, non eseguito.** Non considerare i risultati automatici qui sotto come esiti fisici. Usare solo identità/account di prova e dati sintetici. Non disabilitare Play Protect o protezioni ColorOS.

## Banco di prova e registrazione esiti

Servono: gateway HTTPS isolato con bootstrap v1 abilitato, schema FreePT-Bridge-Test, account admin approved di prova, APK test configurata per quel gateway, Oppo con modello/SDK/ColorOS annotati e un secondo dispositivo Android di confronto. Non utilizzare account/dati o gateway di produzione.

Per ogni caso registrare: versione/commit APK, modello e versione OS, ora inizio/fine, esito PASS/FAIL/BLOCCATO, codice errore sanitizzato e riferimento al rapporto JSON. Annotare i consensi già presenti prima della prova. Non riportare token, chiavi, telefono, codici di pairing o file personali. Conservare screenshot solo delle schermate di prova senza dati personali.

## Preregistrazione

| Caso | Azione | Risultato obbligatorio |
|---|---|---|
| P01 — installazione pulita | Installare APK test su profilo/dispositivo destinato alle prove e aprire | Prima di nome/telefono compare Chieditore. Nessun account/profilo personale creato e nessuna chat aperta |
| P02 — permessi sequenziali | Negare File, tornare, premere Continua; poi concederlo da Impostazioni | Finché negato non passa allo step seguente; il ritorno dall'Activity non basta a produrre «verificato» |
| P03 — notifiche | Negare e poi concedere le notifiche | Nessun token push/account registrato durante la diagnostica; step avanza solo dopo nuova lettura del permesso |
| P04 — consensi già concessi | Chiudere/riaprire con permessi presenti | Nessuna nuova richiesta Android inutile; consensi e sessioni preservati |
| P05 — ColorOS/batteria | Controllare rientro da impostazioni batteria e limitazioni vendor | Stato interrogabile corrisponde al sistema; limiti vendor non verificabili non diventano automaticamente «verificati» |
| P06 — consenso Bridge | Premere Continua su Bridge | Mostra codice tecnico; nessun nome/telefono richiesto e nessun file personale letto |
| P07 — assenza autorizzazione | Lasciare il dispositivo pending, tentare Chiudi diagnostica | Nessun job/trasferimento; chiusura non apre il form personale e non lascia TX superfluo |
| P08 — codice errato/altro account | Da sessione admin test provare codice errato, poi da account user | Nessuna autorizzazione e nessun job; errore breve senza dati interni |
| P09 — approvazione esatta | Dall'admin riconoscere il dispositivo e approvare il codice esatto | Il servizio riceve job sintetico e trasferisce 300.000 byte; ricevuti due chunk e SHA256 corrispondente su entrambe le estremità |
| P10 — passaggio al form | Attendere esito e premere Chiudi diagnostica | Solo ora appare nome/telefono. La presenza della notifica/servizio attivo, da sola, non è sufficiente |
| P11 — rete interrotta | Ripetere interrompendo rete prima di approvazione, tra i chunk e prima della chiusura | Nessun falso successo, nessun account anticipato; retry controllato dopo ripristino, nessun dato sintetico attribuito a un'altra identità |
| P12 — replay/scadenza | Usare banco di prova server per ripetere un envelope e scadere una richiesta tecnica | Replay negato; richiesta scaduta non sblocca registrazione. Una nuova autorizzazione deve essere esplicita |
| P13 — revoca admin/dispositivo | Revocare durante trasferimento e prima del form | La successiva verifica server nega il passaggio. Una grant revocata non viene riattivata dal semplice riavvio |
| P14 — promozione | Completare registrazione test, lasciare pending, poi approvare | Pending non riceve accesso remoto a file personali; dopo approvazione binding una sola volta allo stesso admin, senza altre richieste di permesso |
| P15 — ack perso | Interrompere risposta di claim dopo commit server e riprendere | Stesso dispositivo/secret locale, nessun duplicato, nessun cambio owner/grant |
| P16 — rapporto | Generare errore e condividere manualmente JSON locale | Solo modello/SDK/stati/tempi/codici ammessi; assenti pairing code, token, numeri, nomi, percorsi, file e indirizzi backend |
| P17 — ciclo vita | Chiudere, riaprire, spegnere schermo, riavviare OS e applicare limite dataSync Android 15+ | Nessun crash o falsa attestazione; registrare limiti effettivi di ColorOS/OS. Non dichiarare riavvio background garantito dove vietato |

## SAF amministratore e regressione chat

Preparare due utenti test omonimi «Cristina», un terzo con caratteri Unicode e soli file sintetici. Calcolare gli hash originali sul PC.

| Caso | Azione | Risultato obbligatorio |
|---|---|---|
| S01 | Scegliere una radice; salvare un allegato chat e file/cartella Bridge dello stesso utente | Un solo picker iniziale, stessa sottocartella persona per entrambi i canali, struttura remota preservata |
| S02 | Salvare due utenti omonimi e riaprire l'app | Directory diverse e leggibili, mappatura stabile, nessun UUID come nome predefinito |
| S03 | Cambiare nome al profilo e risalvare | Riusa la directory già mappata, senza perdere/spostare file esistenti |
| S04 | Salvare due volte lo stesso filename, anche con collisione file/directory | Nessun overwrite; suffisso o rifiuto esplicito; hash dei file precedenti invariato |
| S05 | Trasferire 0 byte, 1 byte, 262.144, 262.145 byte e file più grande | Dimensione e hash corrispondono; successo solo dopo verifica nativa/commit |
| S06 | Interrompere rete/download, chiudere processo durante staging e riprendere | Nessun falso «salvato»; journal recupera soltanto staging posseduto e lascia intatti file estranei |
| S07 | Revocare SAF da Impostazioni e riprovare | Nessun successo fittizio; nuova scelta solo quando necessaria; nessuna perdita dei file esistenti |
| S08 | Banco provider simulato: rinominare/rifiutare create o rename, restituire documento esistente | Errore/rollback sicuro, mai scrivere sopra documento preesistente. Ripetere sui provider SAF effettivamente supportati |
| S09 | Tentare `../`, slash, nomi riservati, Unicode equivalente e due download sovrapposti | Nessuna uscita dalla radice, nessuna commistione tra utenti, rifiuto dei concorrenti non supportati |
| S10 | Cambiare chat/account o bloccare utente durante picker/download | Il writer admin rifiuta/annulla; non salva per la persona nuova |
| S11 | Aggiornare in-place con stesso package e certificato | Sessioni, grant Android/SAF, mapping, impostazioni, chat e file preservati; nessun nuovo consenso ingiustificato |
| S12 | Confrontare utente normale con versione base: testo, media, download, sync, scroll, push | UI/azioni e comportamento invariati; nessun «Copia» admin o condivisione admin sul lato utente |
| S13 | Login admin e copia testo con spazi, a capo e Unicode | Nessuna impronta; ruolo/status/sessione verificati, copia esatta e nessun pulsante di condivisione testo/file |

## Criterio di rilascio

Non accettare la APK definitiva finché P01–P17 e S01–S13 non hanno esiti documentati sui dispositivi/provider dichiarati supportati. Un caso BLOCCATO non equivale a PASS. I limiti intrinseci SAF (rename e journal non atomici fra provider e preferenze) richiedono una prova di crash nei punti critici e una politica di provider supportati; non promettere atomicità universale.

Per le prestazioni eseguire almeno 5 trasferimenti dello stesso file sintetico da 2,18 MB su rete/dispositivi/condizioni uguali, riportare mediana e intervallo. Confrontare con baseline omogenea: l'obiettivo 10× non è acquisito dai test automatici o da un singolo trasferimento.
