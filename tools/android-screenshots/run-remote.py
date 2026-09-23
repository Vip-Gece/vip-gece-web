import json
import os
from pathlib import Path
import subprocess
import sys

sys.excepthook = sys.__excepthook__
root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/var/tmp/vip-gece-android-capture-'):
    raise SystemExit('Unexpected scratch directory')
env = dict(os.environ, **json.loads((root/'toolchain-env.json').read_text()))
env.update(CUSTOMER_GATEWAY_URL='', VG_SCREENSHOT_TESTS=str(root/'harness'), VG_SCREENSHOT_OUTPUT=str(root/'screenshots'))
args = [str(root/'toolchain/gradle-8.13/bin/gradle'), '--no-daemon', '--max-workers=2',
        '-Dorg.gradle.jvmargs=-Xmx1024m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8 -Duser.home='+env['HOME'], '-I', str(root/'harness/screenshot.init.gradle'),
        ':app:testDebugUnitTest', '--tests', 'com.vipgece.customer.NativeScreenCaptureTest', '--stacktrace']
subprocess.run(args, cwd=root/'project', env=env, check=True, timeout=900)
print('NATIVE_CAPTURE_COMPLETE', flush=True)
