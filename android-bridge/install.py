#!/usr/bin/env python3
"""Install owner-consented SAF plugin in generated, ISOLATED Android project.

Fails closed on unexpected Capacitor-generated MainActivity; does not touch
original app or ship broad storage permissions.
"""
from pathlib import Path
import re

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
if package != "it.freept.bridge":
    raise SystemExit("BridgeFiles may only be installed into isolated test APK")

if "extends BridgeActivity" not in source:
    raise SystemExit("Unexpected Capacitor Android activity")
if "BridgeFilesPlugin.class" in source or "BridgeCredentialsPlugin.class" in source:
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
    registerPlugin(BridgeCredentialsPlugin.class);
    super.onCreate(savedInstanceState);
  }
""",
)
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
print("BridgeFiles and BridgeCredentials plugins installed in isolated app:", package)
