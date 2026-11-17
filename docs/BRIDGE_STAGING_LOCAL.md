# Bridge staging locale (solo test)

Stato: **eseguibile Node in loopback; non è un servizio pubblico**, e non è
una funzionalità Android/TX già distribuita. Nessun file remoto è accessibile.

## Prerequisiti

1. Un progetto Supabase **distinto** da FreePT produzione.
2. Migrazioni Bridge applicate e collaudate **solo** su quel progetto di test,
   nell'ordine del workflow `.github/workflows/bridge-checks.yml`.
3. Node 22 e `npm install`; mai inserire chiavi privilegiate nel codice,
   in GitHub Actions non protette, nell'APK o in file committati.
4. Variabili di ambiente nel processo backend (non `VITE_*`):

```text
FREEPT_BRIDGE_STAGING=I_UNDERSTAND_LOCAL_TEST_ONLY
FREEPT_BRIDGE_TEST_SUPABASE_URL=https://<test-project>.supabase.co
FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY=<publishable key for test>
FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY=<secret/service_role key for test>
```

Per avviare: `npm run bridge:staging`. Senza configurazione completa
l'avvio fallisce. Il progetto Supabase principale viene rifiutato.
Il listener HTTP usa sempre `127.0.0.1` e una porta effimera.
Non inoltrare questa porta, non usare tunneling o reverse proxy, e non
pubblicare il processo. È destinato a test locali sullo stesso PC.
Il server si ferma con SIGINT/SIGTERM.

Endpoint consentiti (solo per test):
`POST /bridge/admin/list`, `/status`, `/cancel` con Bearer Supabase;
`POST /bridge/tx/connect`, `/poll`, `/complete`.
Nessun enrolment TX, lettura dei file o upload. La registrazione sicura
di un dispositivo deve essere prevista separatamente.

## Limiti ancora da risolvere

- Le chiavi server accedono al solo progetto di prova. Il processo non implementa
  TLS, CORS/origin, anti-replay o rate-limit distribuito: **non esporre su Internet**.
- Non c'è ancora la gestione del ciclo di vita delle autorizzazioni su Android.
- Presenza online e catalogo file non sono ancora implementati end-to-end.
- CI, test PostgreSQL, build APK e test reali devono essere confermati prima
  di un rilascio. Questo documento non certifica alcuna build riuscita.
