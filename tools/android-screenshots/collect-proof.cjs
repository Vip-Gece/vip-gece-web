const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const run = process.argv.find(arg=>arg.startsWith('--run='))?.slice(6) || '20260914';
if (!/^20260914(?:-redesign)?$/.test(run)) throw new Error('Unexpected capture run');
const output = path.join(root, 'output/android-screenshots-'+run);
const scratch = '/var/tmp/vip-gece-android-capture-'+run;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
if (run.endsWith('-redesign')) {
  const narrow=JSON.parse(fs.readFileSync(path.join(output,'narrow-manifest.json')));
  manifest.captures.push(...narrow.captures);
}
const expected=run.endsWith('-redesign')?14:10;
const sourceProof = JSON.parse(fs.readFileSync(path.join(output, 'source-proof.json')));
if (manifest.captures.length !== expected) throw new Error('Missing screenshots');
for (const capture of manifest.captures) {
  if (path.basename(capture.file) !== capture.file) throw new Error('Unsafe capture path');
  const bytes = fs.readFileSync(path.join(output, capture.file));
  if (digest(bytes) !== capture.sha256 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Capture mismatch');
}
if (new Set(manifest.captures.map(c => c.sha256)).size !== expected) throw new Error('Duplicate captures');
const remote = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const scratch=${JSON.stringify(scratch)};
const base=scratch+'/project/app/src';
const hashes=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Unexpected source symlink');if(e.isDirectory())walk(full);else if(e.isFile())hashes.push({file:path.relative(base,full),sha256:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')});}}
(async()=>{walk(base);const ready=await fetch('https://vip-gece.site/api/ready',{signal:AbortSignal.timeout(15000)});console.log(JSON.stringify({at:new Date().toISOString(),current:fs.realpathSync('/var/www/vip-gece-site/current'),readiness:ready.status,hashes}));})().catch(e=>{console.error(e.message);process.exitCode=1});
`;
const proof = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'vip-gece-hetzner', 'node'],
  { input: remote, encoding: 'utf8', timeout: 45000, windowsHide: true }));
const differences = proof.hashes.filter(entry => {
  const file = path.join(root, 'apps/customer-android/app/src', entry.file);
  return !fs.existsSync(file) || digest(fs.readFileSync(file)) !== entry.sha256;
});
if (differences.length || proof.readiness !== 200 || proof.current !== sourceProof.current) throw new Error('Source or live-state verification failed');
proof.localSourceMatches = true;
proof.screenshotHashesMatch = true;
proof.uniqueScreenshotCount = expected;
proof.nativeSourcesCompared = proof.hashes.length;
fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ sourceFiles: proof.hashes.length, sourceMatches: true, screenshotCount: expected, readiness: proof.readiness, productionReleaseUnchanged: true }));

if (process.argv.includes('--cleanup')) {
  const clean = `const fs=require('node:fs');const p=${JSON.stringify(scratch)};if(fs.realpathSync(p)!==p||fs.lstatSync(p).isSymbolicLink())throw Error('Unexpected cleanup path');const proof=JSON.parse(fs.readFileSync(p+'/source-proof.json'));if(proof.archiveHash!==${JSON.stringify(sourceProof.archiveHash)})throw Error('Ownership marker mismatch');fs.rmSync(p,{recursive:true,force:false});console.log(JSON.stringify({removed:p,exists:fs.existsSync(p)}));`;
  const result = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'vip-gece-hetzner', 'node'],
    { input: clean, encoding: 'utf8', timeout: 90000, windowsHide: true }));
  if (result.exists) throw new Error('Scratch directory was not removed');
  fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
