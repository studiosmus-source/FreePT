# FreePT Utente iPhone

Build target: `it.freept.ios.user`; Supabase staging and the existing FreePT accounts.

## Supported on iPhone
- Registration/approval, messages, file attachments, image/video/GIF previews and important notices while the app is open.
- Tap **Condividi file** to open the iOS document chooser. The selected file is attached to the current chat; tap **Invia** to transfer it to FreePT private Storage, where the approved administrator can retrieve it through the existing chat access controls.
- Optional iOS remote-notification support uses APNs and needs the server migration, APNs credentials and Apple Push Notifications capability.

## Not provided
- No remote full-device browsing or background file harvesting. Apple's Files access is per user selection and cannot be transferred from Android's all-files grant.
- No physical iPhone IPA or TestFlight distribution without Apple Developer provisioning, signing and appropriate APNs entitlements. The CI workflow produces an unsigned **iOS Simulator** app to validate native compilation, not an installable iPhone package.

## Apple configuration for physical devices
1. Create or use an Apple Developer App ID matching `it.freept.ios.user` and enable **Push Notifications**. Create App Store Connect/TestFlight entry.
2. Supply signing certificate, Apple Team ID and provisioning profile to an authorized signing workflow. Never put private keys in GitHub source.
3. Deploy migration `20261123_ios_push_platform.sql` and both updated Edge Functions to the **matching** Supabase environment after review. Configure server-side `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID=it.freept.ios.user` and `APNS_ENVIRONMENT=sandbox` for development or `production` for TestFlight.
4. Build a signed iOS app/TestFlight build using Xcode. The existing iPhone package and staging server must use the same environment as Android TEST; do not mix staging with production.

Existing Android, database production and user data must not be overwritten to introduce iOS.
