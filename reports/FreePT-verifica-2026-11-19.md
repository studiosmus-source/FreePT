# FreePT — rapporto aggiornato, 19 novembre 2026

**Stato: implementazione sperimentale in isolamento; APK definitiva NON completata e NON consegnata.** Il Chieditore e il protocollo pre-account ora esistono nel codice. La prova telefonica end-to-end con Keystore Android/servizio/HTTPS e i collaudi fisici restano da eseguire: nessuna build CI li sostituisce.

## Fonte e commit

Ramo: `work/unified-verified-20261119`.
HEAD effettivo verificato alla ripresa: `a37cbd39689d8fdeec6998b145b85c81d263670a`. Il rapporto precedente è conservato nella storia di quel commit.
Commit sorgenti e configurazione CI del presente rapporto: `9560b5bae861fa8f0437f2f5ac508397689d1303`.

| Commit | Contenuto |
|---|---|
| `51ccd599d0b9e327bba6a372b7018be156d45c1c` | Chieditore, protocollo ECDSA, handler isolato, schema e prime prove HTTP/PostgreSQL |
| `6ba38e23d52135ebb5ebd6f908c89784df5afb10` | Binding alla sessione personale, journal SAF, controlli provider e intent rapporto |
| `f763ffc80e5507922cc16ab043b0b280dd6ab64a` | Compatibilità JVM→Node, ripresa onboarding, cancellazione connessioni, protocollo Oppo |
| `db402946511a47c447a10bfcc533c55bec946bf0` | Cancellazione profili compatibile, regressioni sicurezza, assert esecuzione test nativi |
| `0cd7902b6945662f4dce27153714fc51655bad46` | Conservazione consenso SAF su outage, provider che restituisce documenti esistenti, path multilinea |
| `e2c1e86c52b4c6e7ebe8dab98bc6320d9cb4cb28` | Suite nativa estesa a cartelle condivise, collisioni e rename persona/directory |
| `9560b5bae861fa8f0437f2f5ac508397689d1303` | Copertura dei trigger CI per Chieditore, schema, test nativi e lockfile |

Confronto: https://github.com/studiosmus-source/FreePT/compare/a37cbd39689d8fdeec6998b145b85c81d263670a...9560b5bae861fa8f0437f2f5ac508397689d1303

## Implementazione e autorizzazioni

Il Chieditore precede il form nome/telefono nelle build isolate abilitate. Richiede/verifica una voce per volta usando il plugin File esistente e il controllo notifiche senza registrare token push. Rilegge i permessi dopo le Activity, conserva i consensi già presenti, marca ColorOS non interrogabile come «non verificabile». Un tentativo non verificato non apre la registrazione; chiudendolo viene fermato TX. Il rapporto JSON locale contiene solo modello/SDK, stati, tempi e codici ammessi e si condivide manualmente. Nessun invio automatico a AI.

Il dispositivo genera una chiave P-256 nel Keystore e una richiesta tecnica firmata, senza account personale. Solo l'admin Supabase approved, riconoscendo il dispositivo e inserendo il suo codice casuale, può autorizzarla. Nessuna associazione automatica a un admin. Il server verifica la firma esatta di azione, dispositivo, timestamp, nonce e payload; SQL blocca la riga e consuma atomicamente il nonce. Il codice è monouso, memorizzato come hash e scade dopo 15 minuti.

Lo stesso servizio nativo TX ha una corsia pre-account limitata ai dati sintetici: riceve un job diagnostico autorizzato e trasferisce 300.000 byte in due chunk, con confronto byte per byte lato server e SHA256 su entrambi i lati. Non accetta handle o percorsi personali. La sola Activity riuscita, il permesso o `BridgeTxService.active` non attestano successo: servono completamento server, hash corrispondente, servizio e permesso attivi.

Solo dopo questa verifica si può passare al form personale. Dopo l'approvazione personale, claim richiede la stessa chiave e la sessione Supabase approved; la firma include l'hash del token personale contro lo scambio di account. Una transazione crea dispositivo/verifier/grant legacy verso l'esatto admin autorizzante. Nessuna promozione nello stato personale pending. Retry dopo perdita dell'ack riusa il segreto già cifrato nativamente; JS non riceve il segreto. Revoca, scadenza, admin bloccato e owner diverso negano le operazioni. La cancellazione di un profilo non viene bloccata dai nuovi riferimenti.

Dettagli, wire format e gate: [BOOTSTRAP_PRE_ACCOUNT_V1.md](../docs/BOOTSTRAP_PRE_ACCOUNT_V1.md).

## SAF condivisa per persona

Conservato il gestore unico già presente e il trasporto condiviso chat admin/Bridge per owner ID. Aggiunti:

- creazione sicura che rifiuta documenti preesistenti restituiti dal provider, nomi alterati e collisioni senza scrivere sopra file estranei;
- journal persistente dello staging, recupero conservativo dopo ricreazione del plugin e rollback sul solo documento posseduto;
- protezione del picker durante trasferimenti, serializzazione e controlli di path anche con caratteri di controllo multipli;
- conservazione dell'URI/consenso persistente su indisponibilità temporanea del provider, senza nuovo picker automatico;
- prove native simulate di file >256 KiB, omonimi, cambio nome profilo/directory, stessa persona tra chat e cartelle Bridge, struttura annidata, collisioni, revoca, provider anomalo e trasferimenti sovrapposti.

Il journal e il rename SAF non sono una transazione unica universale: un crash nella finestra tra rename provider e aggiornamento preferenze rimane un limite da collaudare. Nessuna promessa di atomicità/assenza di overwrite per provider arbitrari senza prova e politica di supporto.

## Verifiche e risultati

| Livello | Esito | Prova e limite |
|---|---|---|
| Sorgenti/HEAD e chiamanti | Eseguito | Client, server, native, permessi, persistenza, schema, installatore e workflow; confronto dalla base effettiva |
| Statico | PASS | `node --check src/main.js`, controlli sintassi moduli nuovi, compilazione Python e `git diff --check` |
| JavaScript locale/CI | 447 PASS, 0 fail, 0 skip | Suite `bridge/*.test.mjs src/*.test.mjs supabase/*.test.mjs`; include controller e contratto/prove crittografiche, non 447 prove Android |
| Python/JVM | 22 PASS | Include policy nomi Java, generazione firma Java P-256 verificata da Node e fixture/hash identici, più rifiuto del gate bootstrap sul target production |
| HTTP + PostgreSQL CI | PASS, 2 test | Gateway HTTP reale su loopback, ECDSA reale e transazioni PostgreSQL reali. API Supabase Auth sostituita da fixture: non è una prova Auth live. Byte corrotti, replay, approvazione errata, account scambiato, pending, expiry, revoca admin/dispositivo e cancellazione profilo verificati |
| Native SAF simulato | PASS, 11 test, 0 error/failure/skip | Plugin Java reale sotto Robolectric (SDK 28) con trasporto/provider SAF simulati. Workflow richiede almeno 11 test effettivamente eseguiti, zero failure/error/skip; non un test fisico/provider reale |
| Android unificata + firma stabile | PASS | Compilazione, package/certificato e integrità; bootstrap DISABILITATO nella build produzione, APK esclusa dagli artefatti consegnabili |
| Android isolata | PASS | Bootstrap abilitato per compilazione/test; endpoint `.invalid`, nessuna APK operativa pubblicata |
| Build web locale | PASS | Vite; nessun contatto con produzione implicito |
| Supabase test reale | PASS per schema/ACL/RPC SQL | Schema installato, ACL/RLS lette realmente, prova SQL come service_role con rollback; non un telefono collegato al gateway HTTPS |
| Oppo/Android reale/Keystore hardware | NON ESEGUITO | Nessun telefono/emulatore operativo disponibile |
| Regressione chat reale e upgrade in-place | NON ESEGUITO | Codice e test automatici preservati; UI/push/sessioni/permessi dopo installazione vanno collaudati |
| Prestazioni 10× | NON DIMOSTRATO | Nessuna misura omogenea eseguita |

### Pipeline

- Unificata/firma, commit `9560b5b…`: https://github.com/studiosmus-source/FreePT/actions/runs/44481137229
- JavaScript/PostgreSQL, stesso commit: https://github.com/studiosmus-source/FreePT/actions/runs/44481137277
- Isolata e 11 test nativi, commit `e2c1e86…`: https://github.com/studiosmus-source/FreePT/actions/runs/44481037352

Tra `e2c1e86…` e `9560b5b…` cambiano solo trigger di workflow: sorgenti Android/app, test e dipendenze della build isolata sono identici. Il link isolato è riferito esplicitamente al commit eseguito.

Le prime due compilazioni Android sono fallite e sono state corrette: conversione `Intent.setClipData` (metodo void) e gestione checked `JSONException` nel rapporto. Run storiche Android: `44478095477` su `51ccd59…`, `44479156264` su `6ba38e2…`. Nessun errore è stato ignorato per pubblicare APK.

## Supabase: ambiente modificato e prove effettive

**Produzione `cpopqsvzzxfjgnlawlvc`: nessuna scrittura, migrazione, deploy, modifica dati/ruoli/chiavi o Edge Functions. Nessuna modifica Render o email/push.**

Solo `FreePT-Bridge-Test`, ref `aqjuixbuxftnjfzxmzuj`:

| Migrazione applicata | Versione |
|---|---|
| `bridge_bootstrap_device_key_v1` | `20261119072047` |
| `bridge_bootstrap_profile_cascade` | `20261119073139` |

Due nuove tabelle con RLS attiva e nessun accesso diretto anon/authenticated; funzione SECURITY INVOKER, search_path vuoto, EXECUTE solo service_role. Permessi service_role sulle tabelle legacy verificati prima dell'installazione, senza modificarli. Verificati realmente: `anon_execute=false`, `service_execute=true`, `anon_select=false`, `authenticated_insert=false`; entrambe le FK profilo `ON DELETE CASCADE`.

Smoke SQL con ruolo service_role: pending senza profilo personale, replay rifiutato, nessun job prima di autorizzazione, rollback finale. La prima esecuzione smoke ha rilevato un nome variabile SQL ambiguo; corretta e rieseguita con successo. Conteggi finali delle nuove tabelle: **0 dispositivi, 0 nonce**. Nessun account Auth reale o dato personale di prova creato da questi smoke. Lo smoke SQL testa il livello privilegiato, non sostituisce la verifica ECDSA del gateway.

Linter dopo installazione: le due nuove tabelle producono solo l'avviso informativo RLS senza policy, intenzionale perché riservate al gateway. I warning preesistenti relativi a funzioni legacy/Auth non sono stati modificati collateralmente. Riferimento linter: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Script e hash del payload finale:

- `supabase/bootstrap/INSTALL_STAGING_ONLY.sql`: `6a4e04d6cf98be256eff246027e5c1661fcbabccfdc057e10194c4e570787131`.
- `supabase/bootstrap/UPGRADE_PROFILE_CASCADE_STAGING_ONLY.sql`: `e268faa4279ef3e86d6015083f632093ffa3fe9794eab40b3f1d1d118ea3b777`.

L'installazione iniziale più l'upgrade producono lo schema dell'INSTALL finale. Non eseguire questi script automaticamente su produzione.

## Preservazione delle funzioni esistenti

Restano «Copia» solo admin, assenza di condivisione testo/file, login Supabase senza impronta e destinazione per persona già implementati. Nessuna doppia implementazione di firma/fixture Java: `BridgeBootstrapProof` è usata dal servizio e dalla prova JVM.

File identici byte per byte rispetto a `a37cbd3…`:

| File | SHA256 |
|---|---|
| `src/chatAttachmentsUi.js` | `c411ff2d269cce755bf537d6a2c43126947ce622cff8caa5268319a4f1b7dd0b` |
| `src/chatAttachments.js` | `fd8c0834c9ad57f4c67344743939c28914cfde359f087a04efd70a1fb8e97827` |
| `src/pushRegistration.js` | `60b8280cb0ee6727f124701ecc317826e07b747837b56d3a8907e20460f0cfc1` |
| `src/style.css` | `ff6f71001acd0307ce5bd8770c966f238f4ffab67d6a5ec4bd7fe49cb262bc49` |

La nuova logica tocca onboarding e binding prima dell'ingresso in workspace; il gestore nativo SAF condiviso è stato modificato e richiede regressione fisica anche per gli utenti esistenti. Identità dei file non equivale a prova funzionale o visuale della chat.

## Blocchi residui e criterio di consegna

1. **Gateway HTTPS di staging non distribuito/configurato per il telefono.** Il codice è cablato nella composizione HTTPS staging dietro gate esplicito; nessuna modifica alla composizione produzione. Su Render non è disponibile un workspace selezionato e non ne è stato scelto uno arbitrariamente. CI usa rete loopback/database effimeri e la build isolata un host `.invalid`.
2. **Manca prova Android nativo → gateway HTTPS con Auth live e Keystore hardware**, inclusi autorizzazione admin fisica, trasferimento sintetico prima di nome/telefono, report manuale e successivo binding. È un blocco per l'accettazione, non un PASS dedotto dai test.
3. **Mancano i collaudi Oppo/ColorOS**, installazione/aggiornamento in-place, sessioni e permessi persistenti, SAF reale/provider, crash nei punti critici e regressione chat/push reali. Protocollo pronto: [COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md](../docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md), casi P01–P17 e S01–S13 con azioni/esiti obbligatori.
4. **Esposizione pubblica da validare:** TLS/proxy fidato, controllo abusi/capacità, chiavi server, monitoraggio/revoche e backup/rollback verificati. Il codice non introduce un accesso remoto pubblico anonimo: start crea solo pending, le altre capacità richiedono prova del dispositivo e autorizzazione.
5. La build unificata definitiva non ha il bootstrap attivato su produzione; un'attivazione richiede revisione dell'impatto e approvazione dell'utente. Non pubblicare un'APK vecchia o la build isolata come prodotto completo.

## Artefatti e rollback

Nessun merge e nessuna pubblicazione APK. La pipeline unificata conserva solo evidenze (test, identità e hash), la pipeline isolata conserva report nativi. Le build signed/debug in CI non attestano installazione sul telefono.

Rollback del ramo: non unire le modifiche. Rollback staging: disabilitare il gate del nuovo handler; dopo revoca delle eventuali grant promosse, rimuovere soltanto funzione e nuove tabelle, conservando il resto del Bridge. Non presumere che eliminare le tabelle bootstrap revochi grant legacy già promosse. Attualmente gli smoke staging hanno lasciato le nuove tabelle vuote e non hanno promosso dispositivi reali.


### Evidenze finali conservate

- Evidenze unificata (nessuna APK): https://github.com/studiosmus-source/FreePT/actions/runs/44481137229/artifacts/14508292361
- Report HTML/XML dei 11 test nativi simulati: https://github.com/studiosmus-source/FreePT/actions/runs/44481037352/artifacts/14507394991
- Riepilogo macchina: [FreePT-evidenze-2026-11-19.json](FreePT-evidenze-2026-11-19.json).
- Protocollo dispositivo: [COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md](../docs/COLLAUDO_OPPO_PRE_ACCOUNT_E_SAF.md).

SHA256 del candidato unificato calcolato da GitHub Actions: `2c4846c2ddb46743af51ed58d1bd21dc831d12c27b40b52c105e17421c72a9d1`. Firma stabile verificata dalla pipeline con `apksigner` e confronto col certificato atteso. Il candidato non è stato pubblicato/scaricato e l'hash non è stato ricalcolato localmente. Package unificata `it.freept.app`; la build conserva il formato debug firmato del workflow esistente. Questo identificatore non certifica il Chieditore in produzione né l'installazione su Oppo.
