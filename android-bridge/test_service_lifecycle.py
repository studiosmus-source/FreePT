"""Static safety regressions for Android foreground-service lifecycle.

Run with: python3 -m unittest discover -s android-bridge -p 'test_*.py'
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


class ForegroundServiceLifecycleTests(unittest.TestCase):
    def test_only_authorized_service_start_is_sticky(self):
        source = (ROOT / "BridgeTxService.java.template").read_text()
        self.assertEqual(source.count("return START_STICKY;"), 1)
        self.assertIn("return START_NOT_STICKY;", source)
        sticky = source.index("return START_STICKY;")
        for check in ("BridgeAllFilesCore.granted()", "BridgeDeviceSecretStore.configured(this)",
                      'getBoolean("paused",false)', "validEndpoint(endpoint)", "showForeground()"):
            self.assertIn(check, source[:sticky])
        self.assertIn("stopSelf(startId);", source)
        self.assertIn("stopSelf();", source)

    def test_bridge_start_does_not_gate_on_push_permission(self):
        source = (ROOT / "BridgeTxControlPlugin.java.template").read_text()
        self.assertNotIn("requestPermissionForAlias", source)
        self.assertNotIn("bridge_tx_notifications_required", source)
        self.assertIn("BridgeAllFilesCore.granted()", source)
        self.assertIn("BridgeDeviceSecretStore.configured(getContext())", source)
        self.assertIn("startForegroundService", source)

    def test_foreground_notification_remains_visible(self):
        source = (ROOT / "BridgeTxService.java.template").read_text()
        self.assertIn('setContentTitle("FreePT - Connesso")', source)
        self.assertIn(".setOngoing(true)", source)
        self.assertIn("startForeground(NOTIFICATION_ID,notification", source)


if __name__ == "__main__":
    unittest.main()
