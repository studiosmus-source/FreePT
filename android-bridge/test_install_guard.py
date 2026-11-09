"""Regression tests for fail-closed native Bridge installation."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

INSTALLER = Path(__file__).with_name("install.py").resolve()

class InstallerGuardTests(unittest.TestCase):
    def run_guard(self, package, env_extra):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "android/app/src/main/java/it/freept/app/MainActivity.java"
            main.parent.mkdir(parents=True)
            original = (
                f"package {package};\n"
                "import com.getcapacitor.BridgeActivity;\n"
                "public class MainActivity extends BridgeActivity {}\n"
            )
            main.write_text(original)
            env = {**os.environ, "FREEPT_BRIDGE_INSTALL_TARGET": "production",
                   "FREEPT_BRIDGE_PRODUCTION_OPT_IN": "I_ACCEPT_PRODUCTION_BRIDGE"}
            env.pop("VITE_BRIDGE_TEST_API_URL", None)
            env.pop("VITE_BRIDGE_API_URL", None)
            env.update(env_extra)
            result = subprocess.run([sys.executable, str(INSTALLER)],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(main.read_text(), original)
            self.assertFalse((root / "android/app/src/main/AndroidManifest.xml").exists())
            self.assertEqual(list(main.parent.glob("Bridge*.java")), [])
            return result

    def test_production_installs_native_plugins_into_main_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "android/app/src/main/java/it/freept/app/MainActivity.java"
            main.parent.mkdir(parents=True)
            main.write_text(
                "package it.freept.app;\\n"
                "import com.getcapacitor.BridgeActivity;\\n"
                "public class MainActivity extends BridgeActivity {}\\n"
            )
            manifest = root / "android/app/src/main/AndroidManifest.xml"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
                '<application></application></manifest>'
            )
            (root / "android-bridge").symlink_to(INSTALLER.parent, target_is_directory=True)
            env = {**os.environ,
                   "FREEPT_BRIDGE_INSTALL_TARGET": "production",
                   "FREEPT_BRIDGE_PRODUCTION_OPT_IN": "I_ACCEPT_PRODUCTION_BRIDGE",
                   "VITE_BRIDGE_API_URL": "https://bridge.example.org"}
            env.pop("VITE_BRIDGE_TEST_API_URL", None)
            result = subprocess.run([sys.executable, str(INSTALLER)],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("registerPlugin(BridgeTxControlPlugin.class)", main.read_text())
            self.assertTrue((main.parent / "BridgeTxService.java").is_file())
            self.assertIn('android.permission.MANAGE_EXTERNAL_STORAGE', manifest.read_text())
            self.assertIn('BridgeTxService', manifest.read_text())
            self.assertIn('https://bridge.example.org',
                          (root / "android/app/src/main/res/values/freept_bridge.xml").read_text())

    def test_production_missing_endpoint_does_not_modify_files(self):
        self.run_guard("it.freept.app", {})

    def test_production_rejects_staging_endpoint_before_modification(self):
        self.run_guard("it.freept.app", {
            "VITE_BRIDGE_API_URL": "https://bridge.example.org",
            "VITE_BRIDGE_TEST_API_URL": "https://staging.example.org"})

    def test_production_rejects_wrong_identity(self):
        self.run_guard("it.freept.bridge.next", {
            "VITE_BRIDGE_API_URL": "https://bridge.example.org"})

    def test_production_rejects_http_endpoint(self):
        self.run_guard("it.freept.app", {
            "VITE_BRIDGE_API_URL": "http://bridge.example.org"})

if __name__ == "__main__":
    unittest.main()
