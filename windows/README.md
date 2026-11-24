# FreePT Windows TEST — first desktop build

This Windows-only client reuses the existing Vite chat frontend and the isolated FreePT Bridge protocol.
It is a first usable **TEST** build, not an independently verified production remote-access product.

## Security model
- The PC owner signs in with their FreePT TEST account and explicitly selects directories or disks to share.
- A new device is enrolled through the existing HTTPS owner endpoint. The server applies its approved-owner checks.
- Device credentials are stored using Windows DPAPI (CurrentUser), not written to the browser, registry or logs.
- Only those explicitly selected roots can be listed or read. Reparse points and Windows/program/application-data directories are excluded.
- Existing server grants, enable/disable and revocation are authoritative. A revoked initial login stops the agent.
- FreePT Windows never accepts shell commands, input control, writes, file deletion, or unsupervised privilege elevation.
- The tray icon keeps the Bridge running while the UI is hidden; optional HKCU Run starts it at Windows user sign-in.
- Windows must be powered on and the user logged in for this first agent. This is **not** a Windows Service and cannot bypass sleep, logout or offline states.

## Build
GitHub Actions: `Build FreePT Windows TEST` on the isolated FreePT TEST branch.
Requires the existing GitHub Actions variable `FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY` and `FREEPT_BRIDGE_TEST_SUPABASE_URL`.
The workflow runs Windows .NET catalogue tests, builds the Vite TEST chat, publishes a signed-**not-yet** Windows executable as a self-contained win-x64 distribution and uploads a ZIP artifact.

The Windows EXE is **not Authenticode signed** at this stage. Windows SmartScreen may display a warning.
Microsoft Edge WebView2 Runtime is required for the embedded chat.
Do not install over any existing production FreePT deployment: this client targets TEST only.

## Scope of this phase
Initial setup uses Supabase email/password authentication to enroll the owner. Password is used in memory for the sign-in request; it is not stored.
If this user's FreePT account uses a different sign-in mechanism, that method still needs a Windows-compatible flow.
The chat UI is embedded in WebView2. Android-specific native download destinations and Bridge admin views are not yet adapted for desktop.

The PC owner may edit shared roots and click **Salva cartelle condivise**.
Remote browsing from Android uses the existing Bridge page/chunk protocol after device provisioning and grant activation.
