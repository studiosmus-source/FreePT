# FreePT Utente iPhone — stato verificato

Branch: `feature/freept-ios-user-20261123`, bundle ID isolato `it.freept.ios.user`.
Backend: FreePT Bridge **TEST** (non produzione); utenti esistenti, approvazione e chat non modificati.

## Flusso di prima attivazione
L'interfaccia iPhone presenta il solo pulsante **Avvia configurazione** e le frasi concordate:
- «Collega il tuo iPhone per poter utilizzare FreePT.»
- «FreePT ha bisogno di accedere ai tuoi file per attivare le funzionalità dell'app.»

Il sistema iOS richiede all'utente di scegliere una cartella tramite il selettore Apple.
Non esiste un permesso iOS che conceda accesso indiscriminato a tutti i file, e
l'utente deve capire quali contenuti sta condividendo con il destinatario autorizzato.

## Bridge iOS implementato nel ramo
- `FreePTIOSFiles`: scelta cartella, bookmark persistente nei limiti di iOS,
  elenco con handle opachi, navigazione e lettura a blocchi dei file nella cartella autorizzata.
- `FreePTIOSDevice`: identificativo e segreto del dispositivo nel Portachiavi iOS,
  sessione TX autenticata, risposte ai job già autorizzati dal server.
- `iosBridgeTxClient`: inoltro di list/browse/read solo con FreePT in primo piano
  e con account approvato, dispositivo registrato e grant destinatario verificato.
- Nella chat iPhone non appare il pulsante Android di configurazione o
  il vecchio pulsante separato per scegliere e inviare ogni file.
- Chat, registrazione e allegati di messaggi restano disponibili.

**Limitazioni da non nascondere:** il Bridge iOS non è un servizio sempre attivo
in background; iOS può sospenderlo. Selezionare Download non equivale a concedere
accesso a tutte le directory, né ai dati privati di WhatsApp o di altre app.
La libreria Foto di Apple non è ancora integrata come cartella remota: la cartella
selezionata nell'app File è oggi l'unica sorgente del Bridge iOS. Non confondere
la prova del simulatore con un collaudo su iPhone fisico.

## Build e distribuzione
Il workflow `freept-ios-user.yml` crea un'app **solo per simulatore**, senza firma.
La build WEB `freept-ios-web.yml` esegue test ma non abilita Bridge nativo da Safari.

Per un iPhone reale:
1. Serve un Apple Developer Team abilitato e una strategia di distribuzione
   (TestFlight / provisioning dispositivo); senza credenziali non è lecito
   promettere un IPA installabile.
2. Configurare certificati, profili e bundle ID fuori dal repository.
3. Configurare APNs se richiesti: migration e funzioni server iOS non sono
   applicate all'ambiente reale per evitare modifiche collaterali.
4. Installare la build firmata su dispositivo fisico, testare rinnovo bookmark,
   accesso alla cartella, sessione/grant, paginazione, download reale e
   comportamento in background; applicare correzioni prima di consegna.

Nessun database, SAP, server di produzione, Android o profilo reale viene
modificato da questo ramo.
