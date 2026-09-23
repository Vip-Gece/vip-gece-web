import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

sys.excepthook = sys.__excepthook__
ROOT = Path(sys.argv[1]).resolve()
if not str(ROOT).startswith('/var/tmp/vip-gece-android-capture-'):
    raise SystemExit('Unexpected scratch directory')
TOOLS = ROOT / 'toolchain'
SDK = TOOLS / 'sdk'
TOOLS.mkdir(exist_ok=True)
SDK.mkdir(exist_ok=True)
proof = []


def request(url):
    query = urllib.request.Request(url, headers={'User-Agent': 'VIP-Gece-Android-Test-Setup/1.0'})
    with urllib.request.urlopen(query, timeout=90) as response:
        return response.read()


def download(url, name, digest, algorithm='sha256'):
    dest = TOOLS / name
    if not dest.exists():
        query = urllib.request.Request(url, headers={'User-Agent': 'VIP-Gece-Android-Test-Setup/1.0'})
        with urllib.request.urlopen(query, timeout=120) as response, dest.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    actual = hashlib.file_digest(dest.open('rb'), algorithm).hexdigest()
    if actual.lower() != digest.strip().lower():
        raise RuntimeError('Archive digest mismatch: ' + name)
    sha256 = hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest()
    proof.append(dict(name=name, url=url, verified_algorithm=algorithm, verified_digest=actual, sha256=sha256))
    print('VERIFIED', name, sha256, flush=True)
    return dest


def unzip(archive, dest):
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            target = (dest / entry.filename).resolve()
            if not target.is_relative_to(dest.resolve()):
                raise RuntimeError('Unsafe archive path')
            bundle.extract(entry, dest)
            mode = entry.external_attr >> 16
            if mode and target.is_file():
                target.chmod(mode & 0o777)


assets = json.loads(request('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse'))
jdk_info = assets[0]['binary']['package']
jdk_tar = download(jdk_info['link'], jdk_info['name'], jdk_info['checksum'])
java_dirs = sorted(TOOLS.glob('jdk-21*'))
if not java_dirs:
    with tarfile.open(jdk_tar) as bundle:
        bundle.extractall(TOOLS, filter='data')
    java_dirs = sorted(TOOLS.glob('jdk-21*'))
java = java_dirs[0]

gradle_url = 'https://services.gradle.org/distributions/gradle-8.13-bin.zip'
gradle_zip = download(gradle_url, 'gradle-8.13-bin.zip', request(gradle_url + '.sha256').decode())
if not (TOOLS / 'gradle-8.13').exists():
    unzip(gradle_zip, TOOLS)

repository = ET.fromstring(request('https://dl.google.com/android/repository/repository2-3.xml'))
package = next(p for p in repository.findall('remotePackage') if p.attrib.get('path') == 'cmdline-tools;latest')
archive = next(a for a in package.findall('./archives/archive') if a.findtext('host-os') == 'linux')
relative = archive.findtext('./complete/url')
checksum = archive.find('./complete/checksum')
cli_zip = download('https://dl.google.com/android/repository/' + relative, 'android-commandline-tools.zip', checksum.text, checksum.attrib.get('type', 'sha1'))
cli = SDK / 'cmdline-tools/latest'
if not cli.exists():
    unzip(cli_zip, SDK / 'cmdline-tools')
    (SDK / 'cmdline-tools/cmdline-tools').rename(cli)

env = dict(os.environ, JAVA_HOME=str(java), ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK),
           ANDROID_USER_HOME=str(TOOLS/'android-user'), GRADLE_USER_HOME=str(TOOLS/'gradle-cache'),
           HOME=str(ROOT/'home'))
env['PATH'] = str(java/'bin') + ':' + env['PATH']
Path(env['HOME']).mkdir(exist_ok=True)
licenses = SDK/'licenses'
licenses.mkdir(exist_ok=True)
for license_file in (ROOT/'sdk-licenses').glob('*'):
    (licenses/license_file.name).write_bytes(license_file.read_bytes())
cmd = [str(cli/'bin/sdkmanager'), '--sdk_root='+str(SDK), 'platforms;android-36', 'build-tools;35.0.0']
subprocess.run(cmd, env=env, check=True, timeout=600, stdin=subprocess.DEVNULL)
(ROOT/'toolchain-proof.json').write_text(json.dumps(proof, indent=2))
(ROOT/'toolchain-env.json').write_text(json.dumps({k:env[k] for k in ['JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','ANDROID_USER_HOME','GRADLE_USER_HOME','HOME','PATH']}, indent=2))
print('TOOLCHAIN_READY', flush=True)
