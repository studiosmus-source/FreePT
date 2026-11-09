#!/usr/bin/env python3
"""Install FCM into a freshly generated Capacitor Android project.

Requires a private base64-encoded google-services.json via environment.
Never writes credentials to source control. Refuses wrong Android package.
"""
import base64
import json
import os
from pathlib import Path

root = Path("android")
app = root / "app"
project_gradle = root / "build.gradle"
app_gradle = app / "build.gradle"
manifest = app / "src/main/AndroidManifest.xml"
for path in (project_gradle, app_gradle, manifest):
    if not path.is_file():
        raise SystemExit("Missing generated Android file: " + str(path))
if not Path("capacitor.config.json").is_file():
    raise SystemExit("Missing Capacitor config")
app_id = json.loads(Path("capacitor.config.json").read_text()).get("appId")
if app_id != "it.freept.app":
    raise SystemExit("Firebase installer refuses non-production Android package")

encoded = os.environ.get("FREEPT_FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_B64", "")
if not encoded:
    raise SystemExit("Firebase google-services.json secret missing")
try:
    data = json.loads(base64.b64decode(encoded, validate=True))
    clients = data["client"]
    assert isinstance(clients, list)
    assert any(
        c.get("client_info", {}).get("android_client_info", {}).get("package_name") == app_id
        for c in clients
    )
    assert data.get("project_info", {}).get("project_id")
except Exception as exc:
    raise SystemExit("Firebase JSON invalid or package mismatch") from exc

top = project_gradle.read_text()
bottom = app_gradle.read_text()
xml = manifest.read_text()
dependency = "classpath 'com.google.gms:google-services:4.4.2'"
plugin = "apply plugin: 'com.google.gms.google-services'"
permission = '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
if (top.count("dependencies {") < 1 or
        bottom.count("com.android.application") < 1 or
        xml.count("<application") != 1):
    raise SystemExit("Unexpected generated Android project; no files modified")
if dependency in top or plugin in bottom or (app / "google-services.json").exists():
    raise SystemExit("Firebase installer already applied; refuse stacked patch")
# Add plugin classpath inside buildscript dependencies only.
start = top.find("buildscript")
deps = top.find("dependencies {", start)
if start < 0 or deps < 0:
    raise SystemExit("Unexpected root Gradle buildscript")
insertion = deps + len("dependencies {")
top = top[:insertion] + "\n        " + dependency + top[insertion:]
bottom = bottom.rstrip() + "\n\n" + plugin + "\n"
if "android.permission.POST_NOTIFICATIONS" not in xml:
    xml = xml.replace("<application", permission + "\n    <application", 1)

# All preflight checks completed. This file contains public Firebase client
# configuration, NOT the FCM server service-account secret.
project_gradle.write_text(top)
app_gradle.write_text(bottom)
manifest.write_text(xml)
(app / "google-services.json").write_text(json.dumps(data))
print("Firebase Android configuration installed for " + app_id)
