import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/var/tmp/vip-gece-android-capture-'):
    raise SystemExit('Unexpected scratch directory')
env = dict(os.environ, **json.loads((root / 'toolchain-env.json').read_text()))
sdk = Path(env['ANDROID_HOME'])
env['ANDROID_AVD_HOME'] = str(root / 'avd')
Path(env['ANDROID_AVD_HOME']).mkdir(exist_ok=True)
image = 'system-images;android-36;default;x86_64'
cli = sdk / 'cmdline-tools/latest/bin'
subprocess.run([str(cli / 'sdkmanager'), '--sdk_root=' + str(sdk),
                'platform-tools', 'emulator', image],
               env=env, check=True, timeout=1200, stdin=subprocess.DEVNULL)
subprocess.run([str(cli / 'avdmanager'), 'create', 'avd', '--name', 'customer_acceptance',
                '--package', image, '--device', 'pixel_2', '--path', str(root / 'avd/customer_acceptance.avd')],
               input='no\n', text=True, env=env, check=True, timeout=180)
packages = []
for relative in ['platform-tools', 'emulator', 'system-images/android-36/default/x86_64']:
    package = sdk / relative / 'source.properties'
    packages.append({'directory': relative, 'properties': package.read_text() if package.exists() else 'See package.xml'})
(root / 'emulator-setup-proof.json').write_text(json.dumps({'image': image, 'packages': packages,
    'kvm_available': Path('/dev/kvm').exists(), 'physical_device': False}, indent=2))
print('EMULATOR_INSTALLED', flush=True)
