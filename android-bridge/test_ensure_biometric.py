import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).with_name("ensure_biometric.py").resolve()

class BiometricManifestTests(unittest.TestCase):
    def test_insert_once_and_keep_valid_xml(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "android/app/src/main/AndroidManifest.xml"
            p.parent.mkdir(parents=True)
            p.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>')
            for _ in range(2):
                result = subprocess.run([sys.executable, str(SCRIPT)], cwd=folder, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(p.read_text().count("android.permission.USE_BIOMETRIC"), 1)
            ET.fromstring(p.read_text())

    def test_invalid_manifest_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "android/app/src/main/AndroidManifest.xml"
            p.parent.mkdir(parents=True)
            p.write_text("<manifest><application>")
            result = subprocess.run([sys.executable, str(SCRIPT)], cwd=folder, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(p.read_text(), "<manifest><application>")
