# FreePT Bridge — firma Android stabile

Le APK di prova precedenti sono firmate da runner GitHub differenti, quindi non possono aggiornarsi reciprocamente. La chiave privata non è recuperabile dai certificati pubblici contenuti nelle APK.

Per le future build, configurare una volta nel repository GitHub Actions i secrets `FREEPT_BRIDGE_KEYSTORE_B64`, `FREEPT_BRIDGE_STORE_PASSWORD`, `FREEPT_BRIDGE_KEY_ALIAS`, `FREEPT_BRIDGE_KEY_PASSWORD`, `FREEPT_BRIDGE_CERT_SHA256` (certificato atteso). Conservare il keystore con backup cifrato fuori dal repository. Non inserirlo nei sorgenti o nei log.

Il workflow interrompe la pubblicazione senza chiave e controlla la firma con apksigner. Le installazioni vecchie non possono essere aggiornate senza la vecchia chiave: occorre pianificare una migrazione volontaria preservando le vecchie app e le credenziali, eventualmente con nuova identità applicativa, poi verificare TX/RX prima di revocare la vecchia associazione.

Nuovo ID `it.freept.bridge.next`: installabile accanto a `it.freept.bridge`, senza condivisione delle credenziali Android Keystore. Non revocare o disinstallare la vecchia TX prima del collaudo della nuova associazione.
