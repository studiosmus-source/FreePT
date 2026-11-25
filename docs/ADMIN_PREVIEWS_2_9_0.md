# FreePT TEST 2.9.0-admin — solo telefono amministratore

Base richiesta: `fdf1306bd8acddb314ea668d1e20da4cb7346f1a` (TEST 2.8.0).
Pacchetto invariato `it.freept.bridge.next`, versionCode 20; firma TEST esistente.
Installare esclusivamente sul telefono amministratore, senza disinstallare.
Non pubblicare questa build nel canale OTA condiviso con gli utenti.

## Modifiche solo ricevitore

**Obiettivo principale chiarito dall'utente: miniature nell'elenco dei file.**
Le righe delle immagini ora includono una miniatura reale da 56×56 pixel,
caricata automaticamente solo quando la riga è visibile. Una sola lettura
remota alla volta; navigazione, anteprima esplicita e download hanno priorità.
Quando si esce dalla cartella o dal pannello vengono annullati i job e rimossi
gli URL. Cache di sessione limitata a 40 immagini / 12 MiB.
I MIME generici Android sono riconosciuti dall'estensione. Immagini fino a
8 MiB vengono lette e ridotte; JPEG maggiori usano solo l'eventuale EXIF.
Senza EXIF o con codec non supportati resta un'icona, non una miniatura finta.
Non promettere miniature di tutti i formati o delle foto grandi senza EXIF
senza aggiornare il TX: la versione remota non offre un renderer thumbnail.

- MIME generici Android riconosciuti dall'estensione per i formati consentiti.
- Immagini JPEG/PNG/GIF/WebP fino a 8 MiB, senza lettura preliminare ridondante.
- JPEG più grandi: solo eventuale miniatura EXIF nei primi 64 KiB; nessun caricamento integrale nascosto.
- PDF fino a 2 MiB: pagine rasterizzate da Android PdfRenderer, senza iframe,
  servizi esterni, JavaScript PDF o collegamenti eseguiti. Pagina precedente/successiva.
- Video MP4/WebM e audio MP3/M4A/WAV/OGG fino a 8 MiB, se il codec è supportato dal telefono.
- Testo, CSV, JSON e XML fino a 2 MiB resi esclusivamente come testo, mai HTML.
- Errori di decodifica visibili e comando «Scarica file originale» sempre disponibile nel visualizzatore.
- Cache temporanea limitata alla sessione, annullamento e revoca degli URL alla chiusura.

## File, memoria interna e SD

Il browser e il download non filtrano le estensioni: documenti Office, archivi,
APK e altri formati rimangono scaricabili anche senza anteprima.
File vuoti rimangono scaricabili. Un formato scaricabile non è necessariamente
visualizzabile o modificabile direttamente nell'app.

Il TX 2.8.0 esistente enumera già i volumi condivisi leggibili e montati,
comprese eventuali SD, e gli elementi nascosti. Questa patch NON cambia il TX,
i permessi o l'app installata sul telefono utente. Il ricevitore non può
concedere permessi al telefono remoto. Non promettere accesso ad Android/data,
Android/obb, cartelle private di altre app, volumi non montati o altri percorsi
negati da Android. Rimangono i limiti del protocollo esistente (pagina 100 voci,
offset massimo 10.000, dimensione ricevitore 1 TiB); nessuna modifica backend.

## Verifiche e consegna

Il workflow dedicato confronta tutti i file con il commit richiesto e rifiuta
modifiche fuori dalla lista dei componenti amministratore. Esegue regressioni
JS/Python, test Robolectric del ricevitore, compilazione, verifica identità,
firma persistente v1/v2/v3 e SHA-256 dell'APK.
Carica solo un artifact manuale amministratore; nessuna release, aggiornamento
automatico, migrazione SQL, distribuzione backend o installazione remota.

Il test Supabase `production candidate matches the reviewed staging migration
payload byte for byte` fallisce già nella base richiesta: il candidato di
produzione differisce dal bundle staging. Questi SQL non vengono modificati.
Le verifiche del workflow dedicato non includono quel confronto fuori ambito.

Necessario collaudo fisico dopo l'installazione: immagine con MIME generico, PDF
con più pagine, testo contenente HTML mostrato letteralmente, audio/video,
download di file non visualizzabile, apertura di una SD già autorizzata.
Una build verde non prova il funzionamento sul telefono reale.
