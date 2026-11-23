# FreePT iPhone — PWA privata di prova

## Come funziona

Nessun Apple Developer, Mac o firma IPA: FreePT è una web app installabile da Safari mediante **Condividi → Aggiungi alla schermata Home → Aggiungi**. Rimane un sito HTTPS: non è un'IPA e non aggira i vincoli iOS.

Funzioni previste: registrazione, approvazione, chat, invio e visualizzazione di allegati scelti manualmente. Il Bridge nativo, l'accesso remoto ai file e il relativo pannello di permessi non sono disponibili nel target PWA.

## Pubblicazione

Il workflow `.github/workflows/freept-ios-web.yml` genera `dist/` usando **esclusivamente Supabase TEST**, esegue i test e pubblica gli asset nel branch `iphone-pwa-preview`. GitHub Pages (o altro hosting HTTPS statico) deve essere configurato esplicitamente per servire il branch alla radice. **Non considerare il branch un sito pubblico operativo** finché l'URL non è raggiungibile e la registrazione non è stata collaudata.

Variabili GitHub necessarie: `FREEPT_BRIDGE_TEST_SUPABASE_URL` e `FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY`. Non usare service_role, chiavi private o credenziali utente nel frontend. Prima di un test con altri dispositivi, verificare le impostazioni Supabase Auth, CORS e gli URL di redirect dell'host HTTPS.

Questo target usa il flag `VITE_IOS_WEB_APP=true` e il flag `VITE_IOS_USER_APP=true`; il consenso di accesso nativo ai file iPhone viene saltato. Non modificare i rami Android o i file SQL di produzione per distribuire la PWA.

## Limiti

Una PWA non esegue il Bridge file in background. Notifiche web richiedono integrazione dedicata, HTTPS, consenso esplicito e iOS compatibile; non sono collaudate da questa variante. L'utente può scegliere allegati nella chat, ma non concedere accesso generale al filesystem.
