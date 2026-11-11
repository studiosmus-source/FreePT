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
                                      "BridgeTxControlPlugin.class")):
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
    super.onCreate(savedInstanceState);
  }
""",
)
# Preflight every required input before touching generated Android files.
required_templates = [
    "BridgeFilesPlugin", "BridgeCredentialsPlugin", "BridgeDestinationPlugin",
    "BridgeRxKeysPlugin", "BridgeAllFilesPlugin", "BridgeAllFilesCore",
    "BridgeDeviceSecretStore", "BridgeTxService", "BridgeTxControlPlugin", "BridgeTxBootReceiver"
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
main.write_text(source)
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
             "BridgeTxControlPlugin", "BridgeTxBootReceiver"):
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
                 '</intent-filter></receiver>')
if manifest_text.count("</application>") != 1:
    raise SystemExit("Unexpected AndroidManifest app closure")
if "BridgeTxService" in manifest_text:
    raise SystemExit("TX native service already registered")
manifest.write_text(manifest_text.replace("</application>",
    "    " + service + "\n    " + boot_receiver + "\n    </application>", 1))
values = Path("android/app/src/main/res/values")
values.mkdir(parents=True, exist_ok=True)
(values / "freept_bridge.xml").write_text(
    '<resources><string name="bridge_endpoint">' +
    escape(raw) + '</string></resources>\n'
)
print("Bridge native plugins installed for:", target, package)
