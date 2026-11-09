import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("install_firebase.py").resolve()


class FirebaseInstallerTests(unittest.TestCase):
    def prepare(self, package="it.freept.app"):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "android/app/src/main").mkdir(parents=True)
        (root / "capacitor.config.json").write_text(json.dumps({"appId": package}))
        (root / "android/build.gradle").write_text(
            "buildscript { repositories { google() } dependencies { classpath 'com.android.tools.build:gradle:8.7.2' } }"
        )
        (root / "android/app/build.gradle").write_text("apply plugin: 'com.android.application'\n")
        (root / "android/app/src/main/AndroidManifest.xml").write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>'
        )
        return temp, root

    def run_installer(self, root, package="it.freept.app", valid=True):
        payload = {"project_info": {"project_id": "freept-test"},
                   "client": [{"client_info": {"android_client_info": {
                       "package_name": package if valid else "wrong.package"
                   }}}]}
        env = dict(os.environ)
        env["FREEPT_FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_B64"] = base64.b64encode(
            json.dumps(payload).encode()).decode()
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=root, env=env,
                              capture_output=True, text=True)

    def test_valid_production_configuration(self):
        temp, root = self.prepare()
        with temp:
            result = self.run_installer(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / "android/app/google-services.json").is_file())
            self.assertIn("com.google.gms.google-services",
                          (root / "android/app/build.gradle").read_text())
            self.assertIn("POST_NOTIFICATIONS",
                          (root / "android/app/src/main/AndroidManifest.xml").read_text())

    def test_wrong_firebase_package_does_not_modify_android(self):
        temp, root = self.prepare()
        with temp:
            gradle = root / "android/build.gradle"
            original = gradle.read_text()
            result = self.run_installer(root, valid=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(gradle.read_text(), original)
            self.assertFalse((root / "android/app/google-services.json").exists())

    def test_staging_package_refused(self):
        temp, root = self.prepare("it.freept.bridge.next")
        with temp:
            result = self.run_installer(root, package="it.freept.bridge.next")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "android/app/google-services.json").exists())


if __name__ == "__main__":
    unittest.main()
