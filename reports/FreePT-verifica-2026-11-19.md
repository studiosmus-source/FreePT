# FreePT — verifica del ramo isolato, 19 novembre 2026

**Esito di accettazione: NON COMPLETATO. APK non consegnabile.** Questo rapporto distingue il codice modificato dai comportamenti provati. Non certifica l'incarico integrale né il funzionamento Android reale.

Ramo: `work/unified-verified-20261119`.
Base verificata: `a10128daec2b3451d6a6294e7cdf7b5592a4e118`, ramo `feature/admin-share-no-biometric-20261119`.
Commit sorgenti sotto verifica: `712f3f1360987445db2095637355b72b9dea5669`.

## Differenziale e consolidamento

- Eliminati i chiamanti JS di condivisione del testo/file amministratore e i relativi endpoint nativi. Rimane solo «Copia», con controllo del ruolo admin, stato approved e sessione sbloccata. Corrette entrambe le frasi residue sull'impronta (login e errore OTP). Non modificato il login Supabase.
- Conservato il nome del plugin `FreePTAdminShare` per evitare una seconda registrazione. Ora espone solamente `copyText`; rimosso il percorso cache di condivisione dal FileProvider. Conservato il provider utilizzato dall'updater.
- Consolidato il salvataggio nella destinazione SAF esistente: gli adapter chat admin e Bridge passano lo stesso `ownerId` al plugin. La mappatura privata persistente associa radice + identità a un document ID figlio della radice, senza usare il nome come identità e senza adottare cartelle esistenti omonime. Il cambio di nome del profilo riusa la directory mappata.
- Nomi cartella persona normalizzati NFC, limitati per code point, sanitizzati per caratteri riservati/controllo, nomi riservati Windows e omonimi. Suffissi leggibili (2), (3), ecc.; UUID non esposto come nome cartella.
- Operazioni native serializzate sull'istanza del plugin; verifica dimensione su commit e dopo rename del file singolo. Riconvalida del permesso persistente in lettura/scrittura e dell'esistenza della radice.
- La chat admin cattura persona e account al rendering: cambio chat, account o revoca dello stato durante picker/trasferimento provoca rifiuto/rollback, senza attribuire il file alla persona nuova.
- Aggiunto lockfile per rendere ripetibile la risoluzione dipendenze. Nel workflow Android usato `npm ci`, suite JS completa e stesso certificato stabile configurato in CI.

## Verifiche eseguite

| Livello | Risultato | Ambito e limite |
|---|---|---|
| Sorgente analizzato | Eseguito | Rami/HEAD, main.js, adapter destinazione, browser remoto, plugin SAF/copia, installatore, enrollment client/server, schema e workflow |
| Controllo statico | PASS | `node --check src/main.js`, compilazione Python installatore, `git diff --check` |
| Test automatici JS | 434 PASS, 0 fail, 0 skip | `node --test bridge/*.test.mjs src/*.test.mjs supabase/*.test.mjs`; include mock e contratti di sorgente/SQL, non equivale a 434 prove Android o SQL live |
| Test Python/JVM | 20 PASS | `python3 -m unittest discover -s android-bridge -p 'test_*.py'`; un test compila ed esegue la vera policy Java dei nomi con 12 assertion su Unicode, omonimi, limiti e caratteri riservati |
| Build web locale | PASS | Vite; nessun test funzionale del backend implicito |
| Supabase collegato | Sola lettura | Identificati produzione e Bridge-Test, letto schema test e vincolo `owner_id NOT NULL` in produzione; nessuna scrittura/migrazione/deploy |
| Compilazione Android/firma CI | PASS | Compilazione Java/Gradle, installazione plugin/Firebase, firma e identità package; non prova di installazione o funzionamento su dispositivo |
| PostgreSQL CI | PASS, entrambi i job PostgreSQL riusciti | Job isolati con database effimeri e test di permessi/revoca/concorrenza; nessun database di produzione usato per prove |
| Android/Oppo reale, SAF provider, aggiornamento in-place | NON ESEGUITO | Nessun dispositivo o emulatore disponibile in questa sessione |
| Regressione visuale/funzionale chat reale | NON ESEGUITA | Confronto sorgenti e test automatici non sostituiscono la prova completa richiesta |

Run del commit sorgenti, entrambe concluse con successo:

- Android: https://github.com/studiosmus-source/FreePT/actions/runs/44474123444
- Verifiche isolate/PostgreSQL: https://github.com/studiosmus-source/FreePT/actions/runs/44474123395

La run precedente sul commit `a8cf107b1ed7317ff6f849fbd93137350075aea8` è conclusa con successo (Android `44473725684`, verifiche isolate `44473725690`), ma non sostituisce la verifica del commit più recente.

## Protezione della chat utente

File identici byte per byte rispetto alla base:

| File | SHA256 |
|---|---|
| `src/chatAttachmentsUi.js` | `c411ff2d269cce755bf537d6a2c43126947ce622cff8caa5268319a4f1b7dd0b` |
| `src/chatAttachments.js` | `fd8c0834c9ad57f4c67344743939c28914cfde359f087a04efd70a1fb8e97827` |
| `src/pushRegistration.js` | `60b8280cb0ee6727f124701ecc317826e07b747837b56d3a8907e20460f0cfc1` |
| `src/style.css` | `ff6f71001acd0307ce5bd8770c966f238f4ffab67d6a5ec4bd7fe49cb262bc49` |

La funzione `makeChatWriter` originale è conservata per gli utenti. `showMessages` sceglie il nuovo writer solamente per admin; la modifica delle azioni è nel ramo admin. Queste sono evidenze di sorgente, non una certificazione della regressione visuale o funzionale. Le verifiche native sulla destinazione sono condivise e vanno provate anche sul flusso utente.

## Requisiti ancora mancanti — rilascio bloccato

1. **Chieditore/onboarding pre-registrazione NON implementato.** Non esiste ancora il nuovo bootstrap autenticato né il collegamento diagnostico reale prima del profilo. La UI di registrazione attuale non è stata fatta passare per una diagnostica fittizia.
2. Riproduzione del limite attuale: `bridge/preRegistrationBoundary.test.mjs` chiama il vero handler server e verifica 401 senza token, 403 con identità senza profilo e zero chiamate alle RPC privilegiate. `bridge/ownerEnrollment.mjs` richiede un profilo approved; `bridge_devices.owner_id` è obbligatorio e riferisce `profiles(id)`. Non basta anticipare la chiamata UI o verificare `BridgeTxService.active`.
3. La nuova architettura pre-account richiede identità tecnica separata dal profilo personale, autorizzazione amministratore esplicita e prova del possesso di una chiave dispositivo. Una soluzione concreta da implementare è: chiave Keystore per dispositivo, challenge server, approvazione autenticata dell'admin di quella challenge, credenziale monouso a scadenza legata alla chiave, consumo atomico anti-replay/revoca, job diagnostico limitato a dati sintetici con verifica hash. Solo dopo verifica end-to-end si abilita «Chiudi diagnostica» e si passa alla registrazione. L'associazione successiva al profilo deve richiedere prova della stessa chiave. Nessun admin scelto automaticamente, nessuna chiave condivisa, nessuna RLS aggirata. Questo protocollo è una proposta tecnica, non codice implementato o verificato.
4. Mancano report diagnostico esportabile, prove autorizzate di trasferimento sintetico pre-account, prove reali ColorOS e gestione verificata dei ritorni da impostazioni.
5. Il SAF modificato richiede ancora prove native su omonimi persistenti, cambio nome profilo, riapertura/aggiornamento, revoca, provider che rinominano/rifiutano, cartelle intere, interruzione processo/device spento, file >256 KiB e concorrenza. I test JS con mock e il JVM sui nomi non dimostrano questi comportamenti. Il recupero durevole dello staging dopo morte del processo non è stato aggiunto; i limiti di atomicità/assenza di overwrite tra processi dipendono dal provider SAF e non sono stati dimostrati.
6. Nessuna prova prestazionale omogenea: obiettivo 10× NON dimostrato.
7. Nessun aggiornamento in-place/installazione Oppo verificato; nessun endpoint updater reso operativo; nessuna nuova promessa sul funzionamento in background Android 15+.

## Artefatti, produzione e rollback

Il workflow sul ramo di lavoro compila e firma per verificare il candidato, ma **non carica l'APK**: pubblica solo `FreePT-validation-evidence` (risultati, identità e hash). L'eventuale hash presente nei log identifica un candidato CI incompleto e non un rilascio accettato.

Produzione, utenti, dati, chiavi, Supabase schema/Edge Functions/Storage, Render ed email/push non modificati. Nessun merge eseguito. Il ramo stabile precedente resta alla base `a10128d…`; rollback del lavoro: non unire il ramo dedicato. Dopo eventuale futuro rilascio non promettere un downgrade Android senza prima verificarne versione, firma e compatibilità dei dati.


Evidenze della run Android finale: https://github.com/studiosmus-source/FreePT/actions/runs/44474123444/artifacts/14505951774

SHA256 del candidato calcolato dalla pipeline e letto nei log: `aef719c5d62b7f44aab66e4a47c810b6b380df31b46d545ec609b9f697e3df16`. Non è stato riscaricato l'APK per una seconda misura locale, perché il candidato non è pubblicato. Il controllo CI `apksigner verify` e il confronto col certificato stabile sono riusciti. Package verificato `it.freept.app`, versionCode `1`, versionName `1.0`, compile/target SDK 35. La build resta quella debug firmata usata dal workflow preesistente, non una nuova release di produzione.
