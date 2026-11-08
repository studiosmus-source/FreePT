# FreePT – accesso amministratore senza password (staging)

## Comportamento

- **Primo accesso:** nella schermata Amministratore immetti l'email dell'account Supabase Auth **già esistente**. Premi **Invia codice via email**, poi inserisci le sei cifre e premi **Accedi con codice**.
- La funzione non crea account: `signInWithOtp({email, options:{shouldCreateUser:false}})`.
- Il codice è verificato lato Supabase con `verifyOtp({email,token,type:'email'})`.
- Prima di mostrare l'area admin viene letta la riga `profiles` dell'utente autenticato: `role=admin` **e** `status=approved` sono obbligatori. Un account non approvato viene disconnesso.
- Su Android, dopo l'autenticazione, è richiesta l'impronta/biometria se disponibile. La sessione Supabase persistente permette gli accessi successivi senza reinserire il codice, salvo scadenza/revoca/logout.
- Il login precedente con password resta disponibile sotto **Accesso alternativo con password**, per recupero, non è più quello principale.
- **Nessuna password admin o chiave service_role è salvata nel client.**

## Configurazione del progetto di prova

Non eseguire queste modifiche nel progetto FreePT di produzione durante il collaudo.

1. Aprire Supabase **Authentication > Email Templates > Magic Link / OTP** nel progetto isolato.
2. Impostare un template email che contenga il placeholder letterale **`{{ .Token }}`** (sei cifre), per esempio: «Il tuo codice FreePT è: `{{ .Token }}`». Salvare.
3. Verificare che l'autenticazione email e l'invio delle email siano abilitati/configurati e che il destinatario riceva il messaggio. Verificare eventuali limiti e la necessità di SMTP dedicato.
4. L'account amministratore deve esistere in **Authentication > Users** e deve avere una riga `profiles` con UUID coincidente, `role='admin'`, `status='approved'`. **Non** assegnare arbitrariamente i privilegi admin a un anonimo: l'onboarding iniziale va eseguito in modo amministrativo e verificato.
5. Il pulsante **Invia codice** non funziona come accesso iniziale se manca l'account: `shouldCreateUser:false` è intenzionale.
6. Testare l'OTP su APK sperimentale e verificarne il logout, il rifiuto di un codice errato, il blocco di un profilo non approvato e il rientro con impronta.

## Distinzione dei livelli

Il modulo OTP e i relativi test sono sorgenti sperimentali. L'invio email reale, la validazione dei profili su Supabase di prova e il riconoscimento biometrico su Android richiedono collaudi separati prima dell'approvazione.

Riferimento ufficiale: https://supabase.com/docs/guides/auth/auth-email-passwordless
