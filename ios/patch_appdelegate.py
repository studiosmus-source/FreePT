"""Install APNs callback forwarding into a freshly generated Capacitor iOS app.
Only touches the isolated iOS build; refuses already patched/unrecognized files.
"""
from pathlib import Path

APP_DELEGATE = Path("ios/App/App/AppDelegate.swift")
CALLBACKS = '''
    // Capacitor Push Notifications: forward APNs registration to the plugin.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
'''
def patch(source: str) -> str:
    if (source.count("class AppDelegate:") != 1 or
        source.count("import Capacitor") != 1 or
        source.count("import UIKit") != 1 or
        not source.rstrip().endswith("}")):
        raise ValueError("Unrecognized Capacitor AppDelegate; refusing patch")
    if ("didRegisterForRemoteNotificationsWithDeviceToken" in source or
        "didFailToRegisterForRemoteNotificationsWithError" in source):
        raise ValueError("Existing APNs handlers; refusing stacked patch")
    pos = source.rfind("}")
    return source[:pos] + CALLBACKS + "\n" + source[pos:]

if __name__ == "__main__":
    if not APP_DELEGATE.is_file():
        raise SystemExit("Missing generated Capacitor AppDelegate")
    APP_DELEGATE.write_text(patch(APP_DELEGATE.read_text()))
    print("Installed iOS APNs registration callbacks")
