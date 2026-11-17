#!/usr/bin/env python3
"""Idempotent Android biometric permission insertion with XML validation."""
from pathlib import Path
import xml.etree.ElementTree as ET

manifest = Path("android/app/src/main/AndroidManifest.xml")
source = manifest.read_text()
ET.fromstring(source)
permission = '<uses-permission android:name="android.permission.USE_BIOMETRIC" />'
if "android.permission.USE_BIOMETRIC" not in source:
    if source.count("<application") != 1:
        raise SystemExit("Unexpected AndroidManifest: application count")
    updated = source.replace("<application", permission + "\n    <application", 1)
    ET.fromstring(updated)
    manifest.write_text(updated)
ET.fromstring(manifest.read_text())
