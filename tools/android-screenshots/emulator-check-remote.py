import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/var/tmp/vip-gece-android-capture-'):
    raise SystemExit('Unexpected scratch directory')
env = dict(os.environ, **json.loads((root / 'toolchain-env.json').read_text()))
sdk = Path(env['ANDROID_HOME'])
env.update(ANDROID_AVD_HOME=str(root / 'avd'), ADB_SERVER_SOCKET='tcp:127.0.0.1:5038',
           ANDROID_ADB_SERVER_PORT='5038', QT_QPA_PLATFORM='offscreen')
host_libs = root / 'toolchain/host-libs/usr/lib/x86_64-linux-gnu'
env['LD_LIBRARY_PATH'] = str(host_libs) + ':' + str(host_libs / 'pulseaudio')
adb = [str(sdk / 'platform-tools/adb'), '-P', '5038']
proof = {'physical_device': False, 'hardware_accelerated': False, 'boot_complete': False,
         'installed': False, 'launch_verified': False, 'live_backend': False}


def run(args, timeout=30):
    return subprocess.run(args, env=env, cwd=root, capture_output=True, text=True, timeout=timeout)


def limit_cpu():
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[-2:])
    os.nice(10)


process = None
try:
    run(adb + ['start-server'])
    with (root / 'emulator.log').open('w') as log:
        process = subprocess.Popen([str(sdk / 'emulator/emulator'), '-avd', 'customer_acceptance',
            '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-accel', 'off',
            '-gpu', 'swiftshader', '-cores', '2', '-memory', '2048', '-port', '5560',
            '-camera-back', 'none', '-camera-front', 'none'], cwd=root, env=env,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=limit_cpu)
        started = time.monotonic()
        deadline = started + 600
        while time.monotonic() < deadline:
            if process.poll() is not None:
                proof['emulator_exit_code'] = process.returncode
                break
            try:
                status = run(adb + ['-s', 'emulator-5560', 'shell', 'getprop', 'sys.boot_completed'], 10)
                if status.returncode == 0 and status.stdout.strip() == '1':
                    proof['boot_complete'] = True
                    break
            except subprocess.TimeoutExpired:
                pass
            time.sleep(5)
        proof['boot_wait_seconds'] = round(time.monotonic() - started)
        if proof['boot_complete']:
            apk = root / 'project/app/build/outputs/apk/debug/app-debug.apk'
            if apk.exists():
                install = run(adb + ['-s', 'emulator-5560', 'install', str(apk)], 120)
                proof['installed'] = install.returncode == 0 and 'Success' in install.stdout
                if proof['installed']:
                    launch = run(adb + ['-s', 'emulator-5560', 'shell', 'am', 'start', '-W', '-n',
                                      'com.vipgece.customer/.MainActivity'], 90)
                    proof['launch_result'] = launch.stdout.strip()
                    time.sleep(10)
                    pid = run(adb + ['-s', 'emulator-5560', 'shell', 'pidof', 'com.vipgece.customer'])
                    proof['launch_verified'] = launch.returncode == 0 and 'Status: ok' in launch.stdout and bool(pid.stdout.strip())
        else:
            proof['reason'] = 'Software emulator did not complete boot within the bounded test window'
finally:
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
    run(adb + ['kill-server'])
    (root / 'emulator-check-proof.json').write_text(json.dumps(proof, indent=2))
    print(json.dumps(proof), flush=True)
raise SystemExit(0 if proof['launch_verified'] else 1)
