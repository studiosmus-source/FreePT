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
    # The generated AppDelegate is already in the Xcode target. Append native
    # user-picked-folder plugin there, avoiding untracked Xcode project edits.
    native = Path("ios-support/bridge_folder_native.swift")
    if native.is_file():
        current = APP_DELEGATE.read_text()
        supplement = native.read_text()
        if current.count("class FreePTIOSViewController:") != 0:
            raise SystemExit("Native folder Bridge was already installed")
        APP_DELEGATE.write_text(current + "\\n" + supplement)
        storyboard = Path("ios/App/App/Base.lproj/Main.storyboard")
        if not storyboard.is_file():
            raise SystemExit("Missing generated Main.storyboard")
        content = storyboard.read_text()
        old = 'customClass="CAPBridgeViewController" customModule="Capacitor"'
        if content.count(old) != 1:
            raise SystemExit("Unrecognized Capacitor root UIViewController")
        content = content.replace(old,
            'customClass="FreePTIOSViewController" customModule="App" customModuleProvider="target"', 1)
        storyboard.write_text(content)
        print("Installed iOS native selected-folder Bridge")

    print("Installed iOS APNs registration callbacks")
