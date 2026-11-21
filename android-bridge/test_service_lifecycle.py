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

    def test_bridge_start_never_launches_persistent_foreground_notification(self):
        control=(ROOT / "BridgeTxControlPlugin.java.template").read_text()
        boot=(ROOT / "BridgeTxBootReceiver.java.template").read_text()
        self.assertIn("BridgeAllFilesCore.granted()",control)
        self.assertIn("BridgeDeviceSecretStore.configured(getContext())",control)
        self.assertIn("BridgeTxJobService.schedulePeriodic(getContext())",control)
        self.assertIn("BridgeTxJobService.schedule(getContext(),false)",control)
        self.assertIn("BridgeTxJobService.schedulePeriodic(context)",boot)
        self.assertIn("BridgeTxJobService.schedule(context,false)",boot)
        self.assertNotIn("startForegroundService(",control)
        self.assertNotIn("startForegroundService(",boot)
        self.assertNotIn("showForeground()",control)
        self.assertNotIn("requestPermissionForAlias",control)
        self.assertIn("scheduler.cancel(BridgeTxJobService.PERIODIC_JOB_ID)",control)

    def test_fcm_wake_and_bounded_job_are_consent_checked(self):
        installer=(ROOT / "install.py").read_text()
        fcm=(ROOT / "BridgeTxMessagingService.java.template").read_text()
        job=(ROOT / "BridgeTxJobService.java.template").read_text()
        service=(ROOT / "BridgeTxService.java.template").read_text()
        protocol=(ROOT / "BridgeTxProtocol.java.template").read_text()
        self.assertIn("BridgeTxJobService", installer)
        self.assertIn("com.google.firebase.MESSAGING_EVENT", installer)
        self.assertIn('tools:node="remove"', installer)
        self.assertIn("super.onMessageReceived(message)", fcm)
        self.assertIn('get("kind")', fcm)
        self.assertIn('BridgeTxJobService.schedule', fcm)
        self.assertIn("BridgeAllFilesCore.granted()", job)
        self.assertIn("BridgeDeviceSecretStore.configured", job)
        self.assertIn('getBoolean("paused",false)', job)
        self.assertIn("jobFinished(params,retry)", job)
        self.assertIn("BridgeTxProtocol.executeJob", job)
        self.assertIn("BridgeTxJobService.schedule(this,false)", service)
        self.assertIn('case "thumbnail":', protocol)
        self.assertIn("BridgeNativeThumbnailCore.thumbnail", protocol)
        # No extra uses-permission is added for the wake/recovery feature.
        self.assertNotIn("android.permission.ACCESS_", fcm)
        self.assertNotIn("android.permission.ACCESS_", job)

    def test_native_periodic_fallback_respects_owner_pause_and_survives_reboot(self):
        job=(ROOT / "BridgeTxJobService.java.template").read_text()
        boot=(ROOT / "BridgeTxBootReceiver.java.template").read_text()
        control=(ROOT / "BridgeTxControlPlugin.java.template").read_text()
        service=(ROOT / "BridgeTxService.java.template").read_text()
        self.assertIn("PERIODIC_JOB_ID=4753", job)
        self.assertIn(".setPeriodic(PERIOD_MS", job)
        self.assertIn(".setPersisted(true)", job)
        self.assertIn("getPendingJob(PERIODIC_JOB_ID)", job)
        self.assertIn('getBoolean("paused",false)', job)
        self.assertIn("BridgeTxJobService.schedulePeriodic(context)", boot)
        self.assertIn("BridgeTxJobService.schedulePeriodic(this)", service)
        self.assertIn("scheduler.cancel(BridgeTxJobService.PERIODIC_JOB_ID)", control)

    def test_download_notification_is_receiver_only_and_opt_in_is_reused(self):
        native=(ROOT / "BridgeDownloadNoticePlugin.java.template").read_text()
        installer=(ROOT / "install.py").read_text()
        self.assertIn('@CapacitorPlugin(name="BridgeDownloadNotice")',native)
        self.assertIn("android.permission.POST_NOTIFICATIONS",native)
        self.assertIn("checkSelfPermission",native)
        self.assertNotIn("requestPermissions",native)
        self.assertNotIn("startForeground(",native)
        self.assertIn("Download completato",native)
        self.assertIn("Download parziale",native)
        self.assertIn("Download interrotto",native)
        self.assertIn("BridgeDownloadNoticePlugin",installer)


if __name__ == "__main__":
    unittest.main()
