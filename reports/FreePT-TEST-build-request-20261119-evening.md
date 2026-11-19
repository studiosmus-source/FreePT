# Richiesta build FreePT TEST — 19 novembre 2026

Questo commit attiva esclusivamente la pipeline GitHub Actions `bridge-android-staging.yml` sul ramo `work/unified-verified-20261119`.

Nessuna modifica a codice runtime, motore Bridge, testi permessi, configurazione produzione o credenziali.

Prima del rilascio verificare: test automatici, build, firma persistente, fingerprint, package `it.freept.bridge.next`, Supabase TEST, endpoint HTTPS staging e presenza artefatto APK. Il collaudo fisico su OPPO resta distinto e non eseguito.

Nei log Render staging del 19/11/2026 alle 12:18:54 UTC è presente `staging_auth_e2e passed`; il dettaglio JSON della prova va ancora verificato prima di attestare tutti i sottocontrolli.
