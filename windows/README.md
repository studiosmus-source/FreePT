# FreePT Windows TEST — first desktop build

This Windows-only client reuses the existing Vite chat frontend and the isolated FreePT Bridge protocol.
It is a first usable **TEST** build, not an independently verified production remote-access product.

## Security model
- The PC owner signs in with their FreePT TEST account and enables the Bridge after administrator approval; ready Windows drives are then discovered automatically.
- A new device is enrolled through the existing HTTPS owner endpoint. The server applies its approved-owner checks.
- Device credentials are stored using Windows DPAPI (CurrentUser), not written to the browser, registry or logs.
- Only ready drives visible to the signed-in Windows account can be browsed. No privilege elevation or ACL bypass is attempted. Windows junctions/symlinks and FreePT's own private credential folder are excluded.
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
Initial setup uses the approved user session in the embedded FreePT chat, requested only after the owner presses the Windows Bridge activation button. A short-lived, nonce-bound WebView2 message passes the access token in memory to the local native host, which then calls the existing authorized owner enrollment endpoint. No email/password fields, new Supabase sign-in, or account password storage are involved.

**Account continuity limitation:** a first-time Windows WebView session is a new anonymous FreePT account, not automatically the same identity as the user's existing Android session. Admin approval of that Windows account is currently required. Cross-device account linking requires a separate secure flow and is not claimed complete.
The chat UI is embedded in WebView2. Android-specific native download destinations and Bridge admin views are not yet adapted for desktop.

No manual folder or drive selection is required. The Bridge dynamically discovers ready drives (including removable drives when Windows permits access). The owner may stop the Bridge at any time; that pause survives restarts.
Remote browsing from Android uses the existing Bridge page/chunk protocol after device provisioning and grant activation.
