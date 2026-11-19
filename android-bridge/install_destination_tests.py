"""Install test-only Robolectric fixtures into a generated isolated CI project."""
from pathlib import Path
import re
main=list(Path('android/app/src/main/java').rglob('MainActivity.java'))
assert len(main)==1
package=re.search(r'package ([\w.]+);',main[0].read_text()).group(1)
assert package=='it.freept.bridge.next', 'Test fixture only for isolated target'
target=Path('android/app/src/test/java')/package.replace('.','/')
target.mkdir(parents=True,exist_ok=True)
(target/'BridgeDestinationTest.java').write_text(Path('android-bridge/tests/BridgeDestinationTest.java.template').read_text().replace('__PACKAGE__',package))
gradle=Path('android/app/build.gradle')
gradle.write_text(gradle.read_text()+'''
android { testOptions { unitTests.includeAndroidResources = true } }
dependencies {
    testImplementation 'org.robolectric:robolectric:4.14.1'
    testImplementation 'org.mockito:mockito-core:5.14.2'
}
''')
