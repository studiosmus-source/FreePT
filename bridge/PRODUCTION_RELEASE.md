# FreePT production Bridge — deployment gate

This service is **not ready for public traffic** merely because CI passes.
It must never reuse the staging Supabase database, the staging Render service,
or the unrelated TX service.

## Render service
- Name: freept-bridge-production
- Branch: feature/bridge-chunk-receiver-20261108
- Build: npm install --omit=dev
- Start: npm run bridge:serve:production
- Auto-deploy: disabled
- Plan: free

## Required Render environment (server-side only)
- FREEPT_BRIDGE_PRODUCTION=I_ACCEPT_PRODUCTION_BRIDGE
- FREEPT_BRIDGE_PUBLIC=I_ACCEPT_PRODUCTION_BRIDGE
- FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL=https://cpopqsvzzxfjgnlawlvc.supabase.co
- FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY=<production publishable key>
- FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY=<production secret service role key>
- FREEPT_BRIDGE_ALLOWED_ORIGINS=<exact HTTPS Capacitor web origin verified on device>
- PORT=<Render-provided port>

**Never commit or paste service-role secrets into GitHub source, APK, or chat.**
Run `node bridge/productionPreflight.mjs` in the server environment to check
configuration without displaying values. This is only a structural check.

## Required release gates
1. Confirm all Bridge SQL migrations and RPC privileges against the **actual**
   production Supabase project with a read-only inspection; staging CI is not proof.
2. Review migration safety and backups before any production SQL application.
3. Validate admin and owner authentication, device revocation, transfer chunks,
   folder browsing and access isolation on a disposable test dataset.
4. Deploy this dedicated service and verify HTTPS health and authenticated API.
5. Set GitHub Actions variable FREEPT_BRIDGE_PRODUCTION_API_URL to the verified
   production Bridge origin, never the staging URL.
6. Set GitHub Actions secret FREEPT_FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_B64
   using the Firebase config matching Android package it.freept.app.
7. Verify push backend, database webhook and FCM credentials separately.
8. Manually run freept-unified-apk.yml; verify APK ID and Android device behavior.

No production deployment or migration is authorized by this document.
