import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes, createPublicKey, createHash, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.shift();
function option(name) { const index = args.indexOf('--' + name); if (index < 0 || !args[index + 1]) throw new Error('Missing --' + name); return args[index + 1]; }
const secretDir = path.resolve(option('secrets'));
if (!path.isAbsolute(option('secrets')) || secretDir.toLowerCase().startsWith(root.toLowerCase() + path.sep) || secretDir.toLowerCase() === root.toLowerCase()) throw new Error('Signing secrets must be outside the source tree');
const publicPath = path.join(root, 'apps/customer-android/app/src/main/assets/update-public.pem');
const propertyPath = path.join(secretDir, 'signing.properties');
const privatePath = path.join(secretDir, 'update-private.pem');
const storePath = path.join(secretDir, 'customer-commercial.p12');
const keytool = process.env.CUSTOMER_KEYTOOL || 'keytool';
const sha = data => createHash('sha256').update(data).digest('hex');
const run = (exe, argv, env = process.env) => execFileSync(exe, argv, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const publicFrom = privateKey => createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });

if (mode === 'prepare') {
  if (!fs.existsSync(secretDir)) {
    fs.mkdirSync(secretDir, { mode: 0o700 });
    if (process.platform === 'win32') {
      const sid = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value']).toString().trim();
      if (!/^S-1-5-[0-9-]+$/.test(sid)) throw new Error('Cannot resolve signing key owner');
      run('icacls.exe', [secretDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
    }
  }
  const existing = [storePath, propertyPath, privatePath].filter(p => fs.existsSync(p));
  if (existing.length && existing.length !== 3) throw new Error('Incomplete signing material; refusing to overwrite it');
  if (!existing.length) {
    const password = randomBytes(32).toString('hex');
    const env = { ...process.env, CUSTOMER_NEW_STORE_PASSWORD: password };
    run(keytool, ['-genkeypair', '-alias', 'customer-commercial', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=VIP GECE Customer', '-storetype', 'PKCS12', '-keystore', storePath, '-storepass:env', 'CUSTOMER_NEW_STORE_PASSWORD', '-keypass:env', 'CUSTOMER_NEW_STORE_PASSWORD'], env);
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    fs.writeFileSync(privatePath, pair.privateKey, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(propertyPath, `storeFile=${storePath.replaceAll('\\', '/') }\nstorePassword=${password}\nkeyAlias=customer-commercial\nkeyPassword=${password}\n`, { mode: 0o600, flag: 'wx' });
  }
  const publicKey = publicFrom(fs.readFileSync(privatePath));
  if (fs.existsSync(publicPath) && fs.readFileSync(publicPath, 'utf8') !== publicKey) throw new Error('Pinned update key mismatch; refusing key rotation');
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  if (!fs.existsSync(publicPath)) fs.writeFileSync(publicPath, publicKey, { flag: 'wx' });
  console.log(JSON.stringify({ signingProperties: propertyPath, publicKeySha256: sha(publicKey), secretValuesPrinted: false }));
} else if (mode === 'package') {
  const apk = path.resolve(option('apk'));
  const output = path.resolve(option('output'));
  const sdk = path.resolve(option('build-tools'));
  const java = process.env.CUSTOMER_JAVA || 'java';
  const props = Object.fromEntries(fs.readFileSync(propertyPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const expectedCertificate = sha(run(keytool, ['-exportcert', '-alias', props.keyAlias, '-keystore', props.storeFile, '-storepass:env', 'CUSTOMER_EXISTING_STORE_PASSWORD'], { ...process.env, CUSTOMER_EXISTING_STORE_PASSWORD: props.storePassword }));
  const signer = run(java, ['-jar', path.join(sdk, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk]).toString().replaceAll('\r', '');
  const certs = [...signer.matchAll(/^Signer #[0-9]+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(m => m[1]);
  if (certs.length !== 1 || certs[0] !== expectedCertificate) throw new Error('APK is not signed by the commercial key');
  const badging = run(path.join(sdk, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', apk]).toString();
  const info = badging.match(/^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'/m);
  const minSdk = Number(badging.match(/^sdkVersion:'([0-9]+)'/m)?.[1]);
  const targetSdk = Number(badging.match(/^targetSdkVersion:'([0-9]+)'/m)?.[1]);
  if (!info || info[1] !== 'com.vipgece.customer' || !/^[a-zA-Z0-9._-]{1,40}$/.test(info[3]) || minSdk < 26 || targetSdk < 36 || /application-debuggable/m.test(badging)) throw new Error('APK identity or production manifest rejected');
  const bytes = fs.readFileSync(apk);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('APK outside size limits');
  const fileName = `vip-gece-customer-clean-${info[3]}-${info[2]}.apk`;
  const issued = Math.floor(Date.now() / 1000);
  const metadata = { package_name: info[1], version_code: Number(info[2]), version_name: info[3], size_bytes: bytes.length, sha256: sha(bytes), certificate_sha256: expectedCertificate, issued_at: issued, expires_at: issued + 30 * 86400, min_sdk: minSdk, apk_path: '/public/downloads/' + fileName };
  const payload = Buffer.from(JSON.stringify(metadata));
  const key = fs.readFileSync(privatePath);
  if (publicFrom(key) !== fs.readFileSync(publicPath, 'utf8')) throw new Error('Update public key mismatch');
  const signature = sign('RSA-SHA256', payload, key);
  if (!verify('RSA-SHA256', payload, fs.readFileSync(publicPath), signature)) throw new Error('Self-verification failed');
  const envelope = { schema: 1, payload: payload.toString('base64'), signature: signature.toString('base64') };
  fs.mkdirSync(output, { recursive: true });
  const target = path.join(output, fileName);
  if (fs.existsSync(target) && sha(fs.readFileSync(target)) !== metadata.sha256) throw new Error('This version was already packaged with different bytes; increase versionCode');
  fs.writeFileSync(target, bytes);
  fs.writeFileSync(path.join(output, 'vip-gece-customer-clean-latest.json'), JSON.stringify(envelope, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${metadata.sha256}  ${fileName}\n`);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ ...metadata, target_sdk: targetSdk, debuggable: false, apk_signature_verified: true, update_signature_verified: true }, null, 2) + '\n');
  console.log(JSON.stringify({ apk: target, ...metadata }));
} else throw new Error('Mode must be prepare or package');
