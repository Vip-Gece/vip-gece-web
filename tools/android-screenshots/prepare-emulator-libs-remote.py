import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/var/tmp/vip-gece-android-capture-') or os.geteuid() == 0:
    raise SystemExit('Run as the build user in the isolated scratch directory')
packages = ['libx11-6', 'libxcb1', 'libxext6', 'libxrender1', 'libxi6', 'libxtst6',
            'libnss3', 'libpulse0', 'libgl1', 'libegl1', 'libfontconfig1', 'libasound2t64',
            'libxkbcommon0', 'libxkbcommon-x11-0', 'libxkbfile1']
plan = subprocess.run(['apt-get', '--simulate', '--no-install-recommends', 'install', *packages],
                      capture_output=True, text=True, check=True, timeout=60)
if re.search(r'^Remv ', plan.stdout, re.MULTILINE):
    raise SystemExit('Dependency plan would remove packages')
versions = re.findall(r'^Inst (\S+) (?:\[[^\]]+\] )?\((\S+)', plan.stdout, re.MULTILINE)
downloads = root / 'toolchain/host-debs'
libraries = root / 'toolchain/host-libs'
downloads.mkdir(exist_ok=True)
libraries.mkdir(exist_ok=True)
if versions:
    subprocess.run(['apt-get', 'download', *[name+'='+version for name, version in versions]],
                   cwd=downloads, check=True, timeout=600)
proof = {'system_packages_installed': False, 'packages': []}
for package in sorted(downloads.glob('*.deb')):
    subprocess.run(['dpkg-deb', '-x', str(package), str(libraries)], check=True, timeout=60)
    with package.open('rb') as stream:
        proof['packages'].append({'file': package.name, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()})
(root / 'emulator-libraries-proof.json').write_text(json.dumps(proof, indent=2))
print('ISOLATED_EMULATOR_LIBRARIES_READY', len(proof['packages']), flush=True)
