"""Static regressions for the 2.8.1 TX battery change (idle standby + FCM wake)."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent
SERVICE = (ROOT / "BridgeTxService.java.template").read_text()
CONTROL = (ROOT / "BridgeTxControlPlugin.java.template").read_text()
WAKE = (ROOT / "BridgeWakeMessagingService.java.template").read_text()
INSTALL = (ROOT / "install.py").read_text()


class TxBatteryTests(unittest.TestCase):
    def test_stops_after_three_idle_minutes_connected_or_offline(self):
        self.assertIn("static final long IDLE_STOP_MS=180000;", SERVICE)
        # One check in the connected poll loop, one in the reconnect loop.
        self.assertEqual(SERVICE.count("lastActivity>=IDLE_STOP_MS"), 2)
        self.assertEqual(SERVICE.count("if(idleStopDecided()){goIdle("), 2)
        # Activity is only a real remote job.
        self.assertRegex(SERVICE, r"if\(job!=null\)\{\s*lastActivity=")

    def test_idle_stop_releases_session_and_is_standby_not_pause(self):
        idle = SERVICE[SERVICE.index("private void goIdle"):]
        idle = idle[:idle.index("\n    }")]
        self.assertIn('putBoolean(STANDBY,true)', idle)
        self.assertIn('"/bridge/tx/disconnect"', idle)
        self.assertNotIn('"paused"', idle)

    def test_wake_during_idle_decision_is_not_lost(self):
        self.assertIn("synchronized(lifecycle)", SERVICE)
        self.assertIn("else wakeRequested=true;", SERVICE)
        self.assertIn("if(worker==Thread.currentThread())", SERVICE)
        self.assertIn("private volatile Thread worker;", SERVICE)

    def test_start_clears_standby_and_explicit_stop_is_still_a_pause(self):
        self.assertIn("putBoolean(STANDBY,false)", SERVICE)
        self.assertIn('putBoolean("paused",true).putBoolean(BridgeTxService.STANDBY,false)', CONTROL)

    def test_family_screen_shows_ready_in_standby_and_wakes_in_foreground(self):
        self.assertIn('out.put("running",BridgeTxService.active||standby);', CONTROL)
        self.assertIn('!tx.getBoolean("paused",false)', CONTROL)
        self.assertIn("BridgeAllFilesCore.granted()&&BridgeDeviceSecretStore.configured(getContext())", CONTROL)
        self.assertIn("startForegroundService(getContext()", CONTROL)

    def test_wake_entrypoint_unchanged(self):
        self.assertIn('"bridge_wake".equals(message.getData().get("kind"))', WAKE)
        self.assertIn("ContextCompat.startForegroundService", WAKE)

    def test_version_is_above_2_8_0_and_below_admin(self):
        self.assertIn('("FREEPT_TX_BATTERY_FIX", 20, "2.8.1")', INSTALL)


if __name__ == "__main__":
    unittest.main()
