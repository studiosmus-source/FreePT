#!/usr/bin/env python3
"""Install owner-consented SAF plugin in generated, ISOLATED Android project.

Fails closed on unexpected Capacitor-generated MainActivity; does not touch
original app or ship broad storage permissions.
"""
from pathlib import Path
import re
import os

root = Path("android/app/src/main/java")
files = list(root.rglob("MainActivity.java"))
if len(files) != 1:
    raise SystemExit("Expected exactly one generated MainActivity.java")
main = files[0]
source = main.read_text()
match = re.search(r"^package\s+([a-zA-Z_][\w.]*)\s*;", source, re.M)
if not match:
    raise SystemExit("MainActivity missing Java package declaration")
package = match.group(1)
target = os.environ.get("FREEPT_BRIDGE_INSTALL_TARGET", "staging")
if target == "staging":
    if package != "it.freept.bridge.next":
        raise SystemExit("Staging installer refuses non-staging app ID")
elif target == "production":
    if package != "it.freept.app" or os.environ.get("FREEPT_BRIDGE_PRODUCTION_OPT_IN") != "I_ACCEPT_PRODUCTION_BRIDGE":
        raise SystemExit("Production installer requires exact app ID and explicit opt-in")
else:
    raise SystemExit("Unknown Bridge installation target")

bootstrap_enabled = os.environ.get("FREEPT_BRIDGE_BOOTSTRAP") == "STAGING_DEVICE_KEY_V1"
if bootstrap_enabled and target != "staging":
    raise SystemExit("Bootstrap requires the isolated staging installation target")

# The runtime endpoint is injected at APK build time, never committed or guessed.
from urllib.parse import urlparse
from xml.sax.saxutils import escape
endpoint_variable = "VITE_BRIDGE_TEST_API_URL" if target == "staging" else "VITE_BRIDGE_API_URL"
raw = os.environ.get(endpoint_variable, "").strip()
if target == "production" and not raw:
    raise SystemExit("Production Bridge requires an explicit HTTPS endpoint")
if target == "production" and os.environ.get("VITE_BRIDGE_TEST_API_URL"):
    raise SystemExit("Production Bridge refuses staging endpoint variable")
if raw:
    parsed = urlparse(raw)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.port or
            parsed.username or parsed.password or parsed.path not in ("", "/") or
            parsed.query or parsed.fragment or
            parsed.hostname == "cpopqsvzzxfjgnlawlvc.supabase.co"):
        raise SystemExit("Invalid Bridge native HTTPS backend")
    raw = parsed.scheme + "://" + parsed.hostname

if "extends BridgeActivity" not in source:
    raise SystemExit("Unexpected Capacitor Android activity")
if any(name in source for name in ("BridgeFilesPlugin.class",
                                      "BridgeCredentialsPlugin.class",
                                      "BridgeDestinationPlugin.class",
                                      "BridgeRxKeysPlugin.class",
                                      "BridgeAllFilesPlugin.class",
                                      "BridgeTxControlPlugin.class",
                                      "FreePTUpdaterPlugin.class",
                                      "FreePTAdminSharePlugin.class")):
    raise SystemExit("Plugin already registered: refuse stacking patches")
anchor = "public class MainActivity extends BridgeActivity {"
if source.count(anchor) != 1:
    raise SystemExit("Cannot safely patch MainActivity")
source = source.replace(
    "import com.getcapacitor.BridgeActivity;",
    "import com.getcapacitor.BridgeActivity;\nimport android.os.Bundle;",
)
source = source.replace(
    anchor,
    anchor + """
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BridgeFilesPlugin.class);
    registerPlugin(BridgeCredentialsPlugin.class);\n    registerPlugin(BridgeDestinationPlugin.class);
    registerPlugin(BridgeRxKeysPlugin.class);
    registerPlugin(BridgeAllFilesPlugin.class);
    registerPlugin(BridgeTxControlPlugin.class);
    registerPlugin(FreePTUpdaterPlugin.class);
    registerPlugin(FreePTAdminSharePlugin.class);
    registerPlugin(BridgeBootstrapPlugin.class);
    super.onCreate(savedInstanceState);
  }
""",
)
# Preflight every required input before touching generated Android files.
required_templates = [
    "BridgeFilesPlugin", "BridgeCredentialsPlugin", "BridgeDestinationPlugin", "BridgeDestinationNames",
    "BridgeRxKeysPlugin", "BridgeAllFilesPlugin", "BridgeAllFilesCore",
    "BridgeDeviceSecretStore", "BridgeTxService", "BridgeTxControlPlugin", "BridgeTxBootReceiver",
    "BridgeWakeMessagingService",
    "FreePTUpdaterPlugin", "FreePTAdminSharePlugin", "BridgeBootstrapPlugin", "BridgeBootstrapCore", "BridgeBootstrapProof"
]
for name in required_templates:
    path = Path("android-bridge") / (name + ".java.template")
    if not path.is_file() or path.read_text().count("__PACKAGE__") != 1:
        raise SystemExit("Missing or invalid native Bridge template: " + name)
manifest = Path("android/app/src/main/AndroidManifest.xml")
if not manifest.is_file():
    raise SystemExit("Missing generated AndroidManifest.xml")
manifest_preflight = manifest.read_text()
if (manifest_preflight.count("<application") != 1 or
        manifest_preflight.count("</application>") != 1 or
        "android.permission.MANAGE_EXTERNAL_STORAGE" in manifest_preflight or
        "BridgeTxService" in manifest_preflight):
    raise SystemExit("Unexpected AndroidManifest.xml; refusing Bridge patch")
# Firebase messaging's implementation dependency in the Capacitor plugin
# is intentionally NOT exported to application Java compilation. Our native
# FirebaseMessagingService subclass needs the app's own compile dependency.
# Preflight prevents duplicate or unexpected Gradle modifications.
gradle_path = Path("android/app/build.gradle")
if not gradle_path.is_file():
    raise SystemExit("Missing Android app Gradle file")
gradle_source = gradle_path.read_text()
firebase_dependency = "implementation 'com.google.firebase:firebase-messaging:24.1.2'"
if gradle_source.count("dependencies {") != 1 or "firebase-messaging" in gradle_source:
    raise SystemExit("Unexpected Firebase Gradle configuration; refuse stacked patch")
if target == "staging":
    # One source of truth for staging version, without stacking old patches.
    versions = (
        ("FREEPT_STORAGE_FIX", 17, "2.6.0"),
        ("FREEPT_PERMISSION_REPROMPT_FIX", 6, "1.5.0"),
        ("FREEPT_UNIFIED_DESIGN", 5, "1.4.0"),
        ("FREEPT_COMPLETE_UI_FIX", 4, "1.3.0"),
        ("FREEPT_CLASSIC_UI_FIX", 3, "1.2.0"),
    )
    chosen = next(((code, name) for flag, code, name in versions
                   if os.environ.get(flag) == "1"), (2, "1.1.0"))
    if gradle_source.count("versionCode 1") != 1 or gradle_source.count('versionName "1.0"') != 1:
        raise SystemExit("Unexpected generated staging APK version; refusing update")
    gradle_source = gradle_source.replace("versionCode 1", "versionCode " + str(chosen[0]), 1)
    gradle_source = gradle_source.replace('versionName "1.0"', 'versionName "' + chosen[1] + '"', 1)

main.write_text(source)
gradle_path.write_text(gradle_source.replace(
    "dependencies {", "dependencies {" + chr(10) + "    " + firebase_dependency, 1
))
# Bootstrap is compile-time isolated; never enable it in a production build.
for helper_name in ("BridgeBootstrapPlugin", "BridgeBootstrapCore", "BridgeBootstrapProof"):
    main.with_name(helper_name + ".java").write_text(
        (Path("android-bridge") / (helper_name + ".java.template")).read_text().replace("__PACKAGE__", package)
    )
bootstrap_values = Path("android/app/src/main/res/values/freept_bootstrap.xml")
bootstrap_values.parent.mkdir(parents=True, exist_ok=True)
bootstrap_values.write_text('<resources><bool name="bridge_bootstrap_enabled">' +
    ("true" if bootstrap_enabled else "false") + '</bool></resources>\n')
main.with_name("BridgeDestinationNames.java").write_text(
    Path("android-bridge/BridgeDestinationNames.java.template").read_text().replace("__PACKAGE__", package)
)
template = Path("android-bridge/BridgeFilesPlugin.java.template").read_text()
if template.count("__PACKAGE__") != 1:
    raise SystemExit("Unexpected Java template")
main.with_name("BridgeFilesPlugin.java").write_text(
    template.replace("__PACKAGE__", package)
)

credential_template = Path("android-bridge/BridgeCredentialsPlugin.java.template").read_text()
if credential_template.count("__PACKAGE__") != 1:
    raise SystemExit("Unexpected credentials template")
main.with_name("BridgeCredentialsPlugin.java").write_text(
    credential_template.replace("__PACKAGE__", package)
)
destination_template = Path("android-bridge/BridgeDestinationPlugin.java.template").read_text()
if destination_template.count("__PACKAGE__") != 1:
    raise SystemExit("Unexpected destination template")
main.with_name("BridgeDestinationPlugin.java").write_text(
    destination_template.replace("__PACKAGE__", package)
)
rx_template = Path("android-bridge/BridgeRxKeysPlugin.java.template").read_text()
if rx_template.count("__PACKAGE__") != 1:
    raise SystemExit("Unexpected RX credentials template")
main.with_name("BridgeRxKeysPlugin.java").write_text(
    rx_template.replace("__PACKAGE__", package)
)
all_files_template = Path("android-bridge/BridgeAllFilesPlugin.java.template").read_text()
if all_files_template.count("__PACKAGE__") != 1:
    raise SystemExit("Unexpected all-files plugin template")
main.with_name("BridgeAllFilesPlugin.java").write_text(
    all_files_template.replace("__PACKAGE__", package)
)
manifest = Path("android/app/src/main/AndroidManifest.xml")
xml = manifest.read_text()
permission = '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />'
if 'android.permission.MANAGE_EXTERNAL_STORAGE' in xml:
    raise SystemExit("Existing all-files permission; refuse double patch")
if xml.count("<application") != 1:
    raise SystemExit("Unexpected AndroidManifest.xml layout")
manifest.write_text(xml.replace("<application", permission + "\n    <application", 1))
for name in ("BridgeAllFilesCore", "BridgeDeviceSecretStore", "BridgeTxService",
             "BridgeWakeMessagingService",
             "BridgeTxControlPlugin", "BridgeTxBootReceiver", "FreePTUpdaterPlugin",
             "FreePTAdminSharePlugin"):
    template_path = Path("android-bridge") / (name + ".java.template")
    template = template_path.read_text()
    if template.count("__PACKAGE__") != 1:
        raise SystemExit("Unexpected native service template: " + name)
    main.with_name(name + ".java").write_text(
        template.replace("__PACKAGE__", package)
    )
manifest_text = manifest.read_text()
for permission_name in ("RECEIVE_BOOT_COMPLETED", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_DATA_SYNC",
                        "POST_NOTIFICATIONS"):
    token = 'android.permission.' + permission_name
    if token not in manifest_text:
        manifest_text = manifest_text.replace(
            "<application",
            '<uses-permission android:name="' + token + '" />\n    <application',
            1,
        )
service = ('<service android:name=".BridgeTxService" '
           'android:exported="false" '
           'android:foregroundServiceType="dataSync" />')
boot_receiver = ('<receiver android:name=".BridgeTxBootReceiver" '
                 'android:enabled="true" android:exported="false">'
                 '<intent-filter><action android:name="android.intent.action.BOOT_COMPLETED" />'
                 '</intent-filter><intent-filter>'
                 '<action android:name="android.intent.action.MY_PACKAGE_REPLACED" />'
                 '</intent-filter></receiver>')
if manifest_text.count("</application>") != 1:
    raise SystemExit("Unexpected AndroidManifest app closure")
if "BridgeTxService" in manifest_text or "BridgeWakeMessagingService" in manifest_text:
    raise SystemExit("Native service already registered")
# Capacitor's push plugin registers MessagingService itself. Remove that
# service through the manifest merger before registering our single subclass
# so Firebase cannot nondeterministically select one of two receivers.
if 'xmlns:tools=' not in manifest_text:
    if '<manifest xmlns:android="http://schemas.android.com/apk/res/android"' not in manifest_text:
        raise SystemExit("Unexpected AndroidManifest namespace; refuse FCM patch")
    manifest_text = manifest_text.replace(
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"',1
    )
remove_capacitor_receiver = ('<service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" '
    'tools:node="remove" />')
# Firebase SDK also contributes a generic messaging service through its own
# manifest. It must not compete with our one authenticated Bridge + chat entry.
remove_firebase_receiver = ('<service android:name="com.google.firebase.messaging.FirebaseMessagingService" '
    'tools:node="remove" />')
wake_receiver = ('<service android:name=".BridgeWakeMessagingService" '
    'android:exported="false"><intent-filter>'
    '<action android:name="com.google.firebase.MESSAGING_EVENT" />'
    '</intent-filter></service>')
candidate = manifest_text.replace("</application>",
    "    " + service + "\n    " + boot_receiver + "\n    " +
    remove_capacitor_receiver + "\n    " + remove_firebase_receiver + "\n    " + wake_receiver +
    "\n    </application>", 1)
# Validate generated XML before modifying the source file.
import xml.etree.ElementTree as ET
ET.fromstring(candidate)
manifest.write_text(candidate)
values = Path("android/app/src/main/res/values")
values.mkdir(parents=True, exist_ok=True)
(values / "freept_bridge.xml").write_text(
    '<resources><string name="bridge_endpoint">' +
    escape(raw) + '</string></resources>\n'
)

# --- FreePT full-APK self-updater wiring (Phase 1) ---------------------------
# FileProvider to hand the downloaded APK to Android's package installer, and
# the locked /apk-update endpoint. Both inert unless an endpoint is supplied:
# without FREEPT_OTA_APK_UPDATE_URL the updater simply finds no update.
updater_url = os.environ.get("FREEPT_OTA_APK_UPDATE_URL", "").strip()
# Request the sensitive install-packages permission only for a configured,
# explicitly opted-in updater. An inactive updater must not ask for it.
if updater_url:
    manifest_text = manifest.read_text()
    manifest.write_text(manifest_text.replace(
        "<application",
        '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application',
        1))
if updater_url:
    u = urlparse(updater_url)
    if (u.scheme != "https" or not u.hostname or u.port or u.username or u.password or
            u.path != "/apk-update" or u.query or u.fragment or
            u.hostname == "cpopqsvzzxfjgnlawlvc.supabase.co"):
        raise SystemExit("Invalid FreePT OTA APK update endpoint")

authority = package + ".freeptupdater.fileprovider"
provider = ('<provider android:name="androidx.core.content.FileProvider" '
            'android:authorities="' + escape(authority) + '" '
            'android:exported="false" android:grantUriPermissions="true">'
            '<meta-data android:name="android.support.FILE_PROVIDER_PATHS" '
            'android:resource="@xml/freept_updater_paths" /></provider>')
manifest_text = manifest.read_text()
if authority in manifest_text:
    raise SystemExit("Updater FileProvider already registered")
if manifest_text.count("</application>") != 1:
    raise SystemExit("Unexpected AndroidManifest app closure for updater")
manifest.write_text(manifest_text.replace("</application>",
    "    " + provider + "\n    </application>", 1))

xml_dir = Path("android/app/src/main/res/xml")
xml_dir.mkdir(parents=True, exist_ok=True)
(xml_dir / "freept_updater_paths.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<paths><external-files-path name="freept_updates" path="updates/" />'
    '<cache-path name="freept_diagnostics" path="freept-diagnostics/" /></paths>\n'
)
(values / "freept_updater.xml").write_text(
    '<resources><string name="ota_apk_endpoint">' +
    escape(updater_url) + '</string></resources>\n'
)

# Neutral monochrome notification icon for the TX foreground service (Phase 5):
# a simple ring, tinted white by the system, instead of the upload arrow.
drawable_dir = Path("android/app/src/main/res/drawable")
drawable_dir.mkdir(parents=True, exist_ok=True)
(drawable_dir / "ic_freept_service.xml").write_text(
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" '
    'android:width="24dp" android:height="24dp" '
    'android:viewportWidth="24" android:viewportHeight="24">\n'
    '  <path android:fillColor="#FFFFFFFF" '
    'android:pathData="M12,2A10,10 0 1,0 12,22A10,10 0 1,0 12,2Z '
    'M12,5.5A6.5,6.5 0 1,1 12,18.5A6.5,6.5 0 1,1 12,5.5Z" />\n'
    '</vector>\n'
)
print("FreePT APK updater wired (endpoint set:", bool(updater_url), ")")

print("Bridge native plugins installed for:", target, package)
