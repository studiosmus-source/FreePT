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
    # Compile the isolated native Files plugin as part of the already compiled
    # AppDelegate source. This avoids fragile modifications to Xcode pbxproj.
    native = Path("ios-support/FreePTIOSFiles.swift")
    storyboard = Path("ios/App/App/Base.lproj/Main.storyboard")
    if not native.is_file() or not storyboard.is_file():
        raise SystemExit("Missing native Files plugin or iOS storyboard")
    source = APP_DELEGATE.read_text()
    if "class FreePTIOSFiles:" in source:
        raise SystemExit("Files plugin already installed")
    device = Path("ios-support/FreePTIOSDevice.swift")
    if not device.is_file():
        raise SystemExit("Missing native Bridge transport")
    APP_DELEGATE.write_text(source + "\n" + native.read_text() + "\n" + device.read_text())
    board = storyboard.read_text()
    old = 'customClass="CAPBridgeViewController" customModule="Capacitor"'
    new = 'customClass="FreePTIOSBridgeViewController" customModule="App"'
    if board.count(old) != 1:
        raise SystemExit("Unrecognized generated Capacitor storyboard")
    storyboard.write_text(board.replace(old, new))
    print("Installed native iOS Files plugin and registration")
    print("Installed iOS APNs registration callbacks")
