'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const bundleRoot = 'C:\\Users\\o-neo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python';
const tempXlrdRoot = 'C:\\Users\\o-neo\\AppData\\Local\\Temp\\codex_xlrd';
const outputPath = process.argv[2] || '';

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function base64UrlSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64url');
}

function parseCsvLine(line) {
  const out = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

function metadataFields(file) {
  const text = fs.readFileSync(file, 'utf8');
  const result = { requiresDist: [] };
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf(':');
    if (split < 1) continue;
    const key = line.slice(0, split).toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === 'name') result.name = value;
    if (key === 'version') result.version = value;
    if (key === 'requires-python') result.requiresPython = value;
    if (key === 'requires-dist') result.requiresDist.push(value);
  }
  return result;
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function verifyDistribution(root, distInfoName) {
  const dist = path.join(root, distInfoName);
  const recordFile = path.join(dist, 'RECORD');
  const result = {
    root,
    distInfo: distInfoName,
    metadata: metadataFields(path.join(dist, 'METADATA')),
    installer: readOptional(path.join(dist, 'INSTALLER')),
    directUrl: readOptional(path.join(dist, 'direct_url.json')),
    requested: fs.existsSync(path.join(dist, 'REQUESTED')),
    wheel: readOptional(path.join(dist, 'WHEEL')),
    recordSignature: {
      jws: fs.existsSync(path.join(dist, 'RECORD.jws')),
      p7s: fs.existsSync(path.join(dist, 'RECORD.p7s'))
    },
    counts: { rows: 0, verified: 0, missing: 0, mismatched: 0, unhashed: 0 },
    discrepancies: [],
    recordedTimeRange: { earliestBirthtimeUtc: null, latestBirthtimeUtc: null, earliestMtimeUtc: null, latestMtimeUtc: null }
  };

  const times = [];
  const lines = fs.readFileSync(recordFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [relative, hashField] = parseCsvLine(line);
    result.counts.rows += 1;
    const file = path.resolve(root, ...relative.split('/'));
    if (!fs.existsSync(file)) {
      result.counts.missing += 1;
      result.discrepancies.push({ relative, status: 'missing' });
      continue;
    }
    const stat = fs.statSync(file);
    times.push(stat);
    if (!hashField) {
      result.counts.unhashed += 1;
      continue;
    }
    const eq = hashField.indexOf('=');
    const algorithm = eq >= 0 ? hashField.slice(0, eq) : '';
    const expected = eq >= 0 ? hashField.slice(eq + 1) : '';
    if (algorithm !== 'sha256') {
      result.counts.unhashed += 1;
      result.discrepancies.push({ relative, status: 'unsupported-hash', algorithm });
      continue;
    }
    const actual = base64UrlSha256(file);
    if (actual === expected) {
      result.counts.verified += 1;
    } else {
      result.counts.mismatched += 1;
      result.discrepancies.push({ relative, status: 'hash-mismatch', expected, actual });
    }
  }

  if (times.length) {
    const birth = times.map((s) => s.birthtimeMs).sort((a, b) => a - b);
    const mtime = times.map((s) => s.mtimeMs).sort((a, b) => a - b);
    result.recordedTimeRange = {
      earliestBirthtimeUtc: new Date(birth[0]).toISOString(),
      latestBirthtimeUtc: new Date(birth[birth.length - 1]).toISOString(),
      earliestMtimeUtc: new Date(mtime[0]).toISOString(),
      latestMtimeUtc: new Date(mtime[mtime.length - 1]).toISOString()
    };
  }
  return result;
}

function rvaToOffset(buffer, peOffset, optionalSize, rva) {
  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const sectionStart = peOffset + 24 + optionalSize;
  for (let i = 0; i < sectionCount; i += 1) {
    const off = sectionStart + i * 40;
    const virtualSize = buffer.readUInt32LE(off + 8);
    const virtualAddress = buffer.readUInt32LE(off + 12);
    const rawSize = buffer.readUInt32LE(off + 16);
    const rawPointer = buffer.readUInt32LE(off + 20);
    const span = Math.max(virtualSize, rawSize);
    if (rva >= virtualAddress && rva < virtualAddress + span) return rawPointer + (rva - virtualAddress);
  }
  return null;
}

function readCString(buffer, offset) {
  if (offset === null || offset < 0 || offset >= buffer.length) return null;
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0 && end - offset < 4096) end += 1;
  return buffer.subarray(offset, end).toString('ascii');
}

function peInfo(file) {
  const stat = fs.statSync(file);
  const buffer = fs.readFileSync(file);
  const base = {
    file,
    size: stat.size,
    birthtimeUtc: stat.birthtime.toISOString(),
    mtimeUtc: stat.mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    isPe: false,
    certificateTableSize: 0,
    imports: []
  };
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') return base;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return base;
  const optionalSize = buffer.readUInt16LE(peOffset + 20);
  const optional = peOffset + 24;
  const magic = buffer.readUInt16LE(optional);
  const directoryStart = magic === 0x20b ? optional + 112 : magic === 0x10b ? optional + 96 : null;
  base.isPe = true;
  base.machine = `0x${buffer.readUInt16LE(peOffset + 4).toString(16)}`;
  base.optionalMagic = `0x${magic.toString(16)}`;
  if (directoryStart === null || directoryStart + 8 * 5 > buffer.length) return base;
  base.certificateTableSize = buffer.readUInt32LE(directoryStart + 8 * 4 + 4);
  const importRva = buffer.readUInt32LE(directoryStart + 8);
  const importSize = buffer.readUInt32LE(directoryStart + 12);
  base.importDirectorySize = importSize;
  if (!importRva || !importSize) return base;
  let descriptor = rvaToOffset(buffer, peOffset, optionalSize, importRva);
  if (descriptor === null) return base;
  for (let i = 0; i < 2048 && descriptor + 20 <= buffer.length; i += 1, descriptor += 20) {
    const originalThunk = buffer.readUInt32LE(descriptor);
    const timeStamp = buffer.readUInt32LE(descriptor + 4);
    const forwarder = buffer.readUInt32LE(descriptor + 8);
    const nameRva = buffer.readUInt32LE(descriptor + 12);
    const firstThunk = buffer.readUInt32LE(descriptor + 16);
    if (!(originalThunk || timeStamp || forwarder || nameRva || firstThunk)) break;
    const name = readCString(buffer, rvaToOffset(buffer, peOffset, optionalSize, nameRva));
    if (name) base.imports.push(name.toLowerCase());
  }
  base.imports = [...new Set(base.imports)].sort();
  return base;
}

function walkFiles(root, predicate, results = []) {
  if (!fs.existsSync(root)) return results;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && predicate(full)) results.push(full);
    }
  }
  return results;
}

const distributions = [
  [bundleRoot, 'pandas-3.0.1.dist-info'],
  [bundleRoot, 'numpy-2.3.5.dist-info'],
  [bundleRoot, 'python_dateutil-2.9.0.post0.dist-info'],
  [bundleRoot, 'tzdata-2026.3.dist-info'],
  [bundleRoot, 'openpyxl-3.1.5.dist-info'],
  [bundleRoot, 'xlsxwriter-3.2.9.dist-info'],
  [tempXlrdRoot, 'xlrd-2.0.2.dist-info']
].map(([root, dist]) => [path.join(root, 'Lib', 'site-packages'), dist]);

// xlrd was installed with --target, so its dist-info is directly below tempXlrdRoot.
distributions[6] = [tempXlrdRoot, 'xlrd-2.0.2.dist-info'];

const distributionReports = [];
for (const [root, dist] of distributions) {
  try {
    distributionReports.push(verifyDistribution(root, dist));
  } catch (error) {
    distributionReports.push({ root, distInfo: dist, error: String(error && error.message || error) });
  }
}

const fixedPeTargets = [
  path.join(bundleRoot, 'python.exe'),
  path.join(bundleRoot, 'python312.dll'),
  path.join(bundleRoot, 'vcruntime140.dll'),
  path.join(bundleRoot, 'vcruntime140_1.dll'),
  'C:\\Users\\o-neo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe',
  'C:\\Users\\o-neo\\.codex\\.sandbox-bin\\codex-command-runner-0.154.0-alpha.6.2.exe',
  'C:\\Windows\\System32\\cmd.exe',
  'C:\\Windows\\System32\\WerFault.exe',
  'C:\\Tools\\Python313\\python.exe',
  'C:\\Tools\\Python313\\python313.dll'
].filter((file) => fs.existsSync(file));

const extensionPeFiles = [
  ...walkFiles(path.join(bundleRoot, 'Lib', 'site-packages', 'pandas'), (file) => /\.(?:pyd|dll)$/i.test(file)),
  ...walkFiles(path.join(bundleRoot, 'Lib', 'site-packages', 'pandas.libs'), (file) => /\.(?:pyd|dll)$/i.test(file)),
  ...walkFiles(path.join(bundleRoot, 'Lib', 'site-packages', 'numpy'), (file) => /\.(?:pyd|dll)$/i.test(file)),
  ...walkFiles(path.join(bundleRoot, 'Lib', 'site-packages', 'numpy.libs'), (file) => /\.(?:pyd|dll)$/i.test(file))
];

const peReports = [...fixedPeTargets, ...extensionPeFiles].map((file) => {
  try { return peInfo(file); } catch (error) { return { file, error: String(error && error.message || error) }; }
});

const packageNativeImportCounts = {};
for (const report of peReports.filter((r) => extensionPeFiles.includes(r.file))) {
  for (const imported of report.imports || []) packageNativeImportCounts[imported] = (packageNativeImportCounts[imported] || 0) + 1;
}

const report = {
  generatedUtc: new Date().toISOString(),
  method: 'Read-only file hashing and PE/static metadata parsing; no Python module was imported or executed.',
  distributions: distributionReports,
  fixedPeTargets: peReports.filter((r) => fixedPeTargets.includes(r.file)),
  packageNativeFileCount: extensionPeFiles.length,
  packageNativeImportCounts: Object.fromEntries(Object.entries(packageNativeImportCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  packageNativeFiles: peReports.filter((r) => extensionPeFiles.includes(r.file))
};

const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    bytes: Buffer.byteLength(serialized),
    generatedUtc: report.generatedUtc,
    distributions: report.distributions.length,
    fixedPeTargets: report.fixedPeTargets.length,
    packageNativeFileCount: report.packageNativeFileCount
  }, null, 2));
} else {
  console.log(serialized);
}
