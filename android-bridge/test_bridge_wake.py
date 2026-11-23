"""Native FCM data-only Bridge wake integration: no duplicate Firebase handlers."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
WAKE=(ROOT/"BridgeWakeMessagingService.java.template").read_text()
INSTALL=(ROOT/"install.py").read_text()

class BridgeWakeTests(unittest.TestCase):
    def test_single_native_receiver_preserves_capacitor_chat(self):
        self.assertIn("extends MessagingService",WAKE)
        self.assertIn('super.onMessageReceived(message)',WAKE)
        self.assertIn('"bridge_wake".equals(message.getData().get("kind"))',WAKE)
        self.assertIn('ContextCompat.startForegroundService',WAKE)
        self.assertIn("BridgeDeviceSecretStore.configured",WAKE)
        self.assertIn("BridgeAllFilesCore.granted",WAKE)
        self.assertIn('getBoolean("paused",false)',WAKE)
        self.assertIn('tools:node="remove"',INSTALL)
        self.assertIn('"BridgeWakeMessagingService"',INSTALL)
        self.assertIn('com.google.firebase.MESSAGING_EVENT',INSTALL)

    def test_does_not_bypass_android_or_touch_stored_credentials(self):
        self.assertIn("catch (RuntimeException limited)",WAKE)
        self.assertNotIn("BridgeDeviceSecretStore.save",WAKE)
        self.assertNotIn("BridgeDeviceSecretStore.clear",WAKE)
        self.assertNotIn("startActivity",WAKE)
        self.assertNotIn("PowerManager",WAKE)
        self.assertNotIn("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",WAKE)

if __name__=="__main__": unittest.main()
