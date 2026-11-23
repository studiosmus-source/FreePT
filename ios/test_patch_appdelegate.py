import unittest
from pathlib import Path
import importlib.util
path=Path(__file__).with_name("patch_appdelegate.py")
spec=importlib.util.spec_from_file_location("patch_appdelegate",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class APNSPatchTests(unittest.TestCase):
    def test_patch_exactly_once_and_preserve_existing_delegate(self):
        base="import UIKit\nimport Capacitor\nclass AppDelegate: UIResponder {\n    var window: UIWindow?\n}\n"
        new=mod.patch(base)
        self.assertIn("var window: UIWindow?",new)
        self.assertEqual(new.count("didRegisterForRemoteNotificationsWithDeviceToken"),1)
        self.assertEqual(new.count("didFailToRegisterForRemoteNotificationsWithError"),1)
        with self.assertRaises(ValueError):
            mod.patch(new)
    def test_refuse_non_capacitor_delegate(self):
        with self.assertRaises(ValueError):
            mod.patch("class AppDelegate {}")
