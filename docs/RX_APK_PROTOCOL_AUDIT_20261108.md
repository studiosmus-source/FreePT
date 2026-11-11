# RX-oppo-fix APK — audit per FreePT Bridge (2026-11-08)

## Input effettivamente analizzato
- Allegato: `RX-oppo-fix (1).apk` (2.6 MB).
- SHA-256 calcolato sul file ricevuto:
  `c68b15c9cd093e648dda06c2abab5942618b87fa7e8d14685337b778f8685778`.
- Analisi statica dei file DEX nell'APK (quattro DEX; classi RX in
  `classes3.dex` e `classes4.dex`), senza installazione/esecuzione.
- Identificati: `it.osmus.rx.remote.RxApi`, `RxSecrets`,
  `MainActivity`, `RemoteFile`, `DirectoryPage`,
  `RemoteChunk`, `TransferIntegrity`, `PhotoVerifier`.
- Endpoint e URL verificati nei DEX:
  `https://tx-3dhs.onrender.com`, `/v1/pair/pending`,
  `/v1/pair/approve/`, `/v1/rx/request`,
  `/v1/rx/result/`.
- Tracce nel DEX: download annullabile, scrittura in Download,
  controllo che il file salvato corrisponda all'originale.
- NON sono stati recuperati né esportati segreti, chiavi, dati di file
  o credenziali dell'APK.

## Sorgenti complementari consultati
Repo `studiosmus-source/TX`, ramo `main`,
commit esaminato `67fec618483f06f0dab2d3ef50d088311cea3721`:
- `rx/src/main/java/it/osmus/rx/remote/RxApi.kt`
- `rx/src/main/java/it/osmus/rx/remote/RxSecrets.kt`
- `rx/src/main/java/it/osmus/rx/MainActivity.kt`
- `relay/server.mjs`.

Questi sorgenti spiegano il protocollo visto nell'APK, ma non costituiscono
una prova che il codice del repository sia binariamente identico all'APK.

## Schema del traffico già esistente in RX / TX
1. RX invia `POST /v1/rx/request` con operazione `list` o
   `read`, percorso relativo, offset e limite/dimensione richiesta.
2. Il relay mette in coda il lavoro e TX lo ritira tramite
   `GET /v1/tx/next`.
3. TX risponde tramite `POST /v1/tx/result/:id`.
4. RX recupera da `GET /v1/rx/result/:id`, ripetendo se `pending`.
5. Per `read`, RX usa blocchi di 65.536 byte, verifica
   `nextOffset == offset + lunghezza`, consistenza di `totalBytes`
   e valore `complete`; salva via ContentResolver, senza accumulare
   l'intero file in RAM, e consente annullamento.
6. Per `list`, RX usa paginazione fino a 200 voci e l'indicatore
   `hasMore`.
7. Le credenziali RX sono cifrate con Android Keystore; il server
   preesistente usa token TX/RX condivisi.

## Cosa trasferire concettualmente in FreePT Bridge
- Macchina a stati di richiesta/risposta e polling con timeout.
- Lettura a blocchi con offset, totale stabile, fine file e integrità.
- Download a streaming con selettore destinazione Android,
  annullamento e pulizia del file parziale.
- Paginazione delle cartelle e anteprima limitata.
- Errori distinti per autorizzazione scaduta, telefono non connesso,
  relay indisponibile e trasferimento interrotto.

## Cosa NON copiare
- Non inserire `RX_TOKEN` o `TX_TOKEN` nell'APK FreePT.
- Non collegare FreePT al relay TX attualmente operativo; coda e
  token di TX non sono isolati per dispositivo/ricevente.
- Non adottare l'accesso indiscriminato ai file di TX: Bridge già usa
  il selettore SAF esplicito su Android.
- Non considerare RX sul telefono una prova di funzionamento
  dell'attuale Bridge; sono protocolli differenti.

## Gap concreti Bridge
Il protocollo Bridge testato oggi porta solo una pagina del catalogo
(`list`). Per i file servono contratti e job `read` per chunk,
identificatori di elemento stabili e vincolati alla cartella selezionata,
risposte associate al job e alla sessione autenticata, revoca atomica,
destinazione Android con salvataggio a streaming e verifica dell'integrità.
Per una cartella intera servono paginazione, struttura relativa sicura
e download di più file. Il gateway HTTPS Bridge è stato solo predisposto:
prima del test su due telefoni richiede deploy separato e DB staging.

## Livello di verifica
APK analizzato staticamente, sorgenti TX consultati; nessuna
decompilazione completa, emulazione o prova di rete sull'APK.
Nessuna modifica a TX, Render TX, FreePT `main` o Supabase produzione.
