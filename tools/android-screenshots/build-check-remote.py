import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/var/tmp/vip-gece-android-capture-'):
    raise SystemExit('Unexpected scratch directory')
env = dict(os.environ, **json.loads((root / 'toolchain-env.json').read_text()))
env.update(CUSTOMER_GATEWAY_URL='', VG_SCREENSHOT_TESTS=str(root / 'harness'),
           VG_SCREENSHOT_OUTPUT=str(root / 'screenshots'))
command = [str(root / 'toolchain/gradle-8.13/bin/gradle'), '--no-daemon', '--max-workers=2',
           '-Dorg.gradle.jvmargs=-Xmx1536m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8 -Duser.home=' + env['HOME'],
           '-I', str(root / 'harness/screenshot.init.gradle'),
           ':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug']
result = subprocess.run(command, cwd=root / 'project', env=env, timeout=1800)
proof = {'gradle_exit_code': result.returncode, 'physical_device': False, 'live_backend': False,
         'commercial_artifact': False, 'test_reports': []}
for report in (root / 'project/app/build/test-results').rglob('TEST-*.xml'):
    tests = ET.parse(report).getroot()
    proof['test_reports'].append({'file': str(report.relative_to(root)),
        'tests': tests.attrib.get('tests'), 'failures': tests.attrib.get('failures'),
        'errors': tests.attrib.get('errors'), 'skipped': tests.attrib.get('skipped')})
apk = root / 'project/app/build/outputs/apk/debug/app-debug.apk'
if apk.exists():
    with apk.open('rb') as stream:
        proof['test_apk_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
(root / 'build-check-proof.json').write_text(json.dumps(proof, indent=2))
print(json.dumps(proof), flush=True)
raise SystemExit(result.returncode)
