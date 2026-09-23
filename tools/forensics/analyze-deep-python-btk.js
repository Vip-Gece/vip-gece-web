'use strict';

const fs = require('fs');
const path = require('path');

const base = process.argv[2];
const output = process.argv[3];
if (!base || !output) {
  console.error('Usage: node analyze-deep-python-btk.js <evidence-directory> <output-json>');
  process.exit(2);
}

function readText(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  return buffer.toString('utf8');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeXml(String(value).replace(/<[^>]*>/g, '')).trim();
}

function redact(value) {
  return String(value || '')
    .replace(/((?:api[_-]?key|token|password|passwd|secret|authorization)\s*[=:]\s*)[^\s"']+/gi, '$1<redacted>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1<redacted>');
}

function parseEvents(file, source) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return [];
  const text = readText(file);
  const blocks = text.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) || [];
  return blocks.map((xml) => {
    const eventId = Number((xml.match(/<EventID(?:\s[^>]*)?>(\d+)<\/EventID>/i) || [])[1]);
    const provider = decodeXml((xml.match(/<Provider\s+Name=['"]([^'"]+)['"]/i) || [])[1] || '');
    const time = (xml.match(/<TimeCreated\s+SystemTime=['"]([^'"]+)['"]/i) || [])[1] || '';
    const recordId = Number((xml.match(/<EventRecordID>(\d+)<\/EventRecordID>/i) || [])[1]);
    const data = {};
    let unnamed = 0;
    const pattern = /<Data(?:\s+Name=['"]([^'"]+)['"])?[^>]*>([\s\S]*?)<\/Data>/gi;
    let match;
    while ((match = pattern.exec(xml)) !== null) {
      const key = match[1] || `Data${unnamed++}`;
      data[key] = redact(stripTags(match[2]));
    }
    return { source, provider, eventId, time, recordId, data };
  });
}

function numericPid(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const valueNumber = text.startsWith('0x') ? parseInt(text.slice(2), 16) : parseInt(text, 10);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function values(event) {
  return Object.values(event.data).join('\n');
}

function compact(event) {
  const wanted = [
    'RuleName', 'UtcTime', 'ProcessGuid', 'ProcessId', 'Image', 'FileVersion',
    'Description', 'Product', 'Company', 'OriginalFileName', 'CommandLine',
    'CurrentDirectory', 'User', 'LogonGuid', 'LogonId', 'TerminalSessionId',
    'IntegrityLevel', 'Hashes', 'ParentProcessGuid', 'ParentProcessId',
    'ParentImage', 'ParentCommandLine', 'ParentUser', 'SourceProcessGuid',
    'SourceProcessId', 'SourceImage', 'TargetProcessGuid', 'TargetProcessId',
    'TargetImage', 'GrantedAccess', 'CallTrace', 'ImageLoaded', 'Signed',
    'Signature', 'SignatureStatus', 'TargetFilename', 'CreationUtcTime',
    'PreviousCreationUtcTime', 'QueryName', 'QueryStatus', 'QueryResults',
    'Initiated', 'SourceIp', 'SourceHostname', 'SourcePort', 'DestinationIp',
    'DestinationHostname', 'DestinationPort', 'Protocol', 'PipeName',
    'EventType', 'TargetObject', 'Details', 'NewProcessId', 'NewProcessName',
    'CreatorProcessId', 'CreatorProcessName', 'ProcessName', 'ProcessCommandLine',
    'ParentProcessName', 'SubjectUserName', 'SubjectDomainName', 'ExitStatus',
    'Application', 'Direction', 'LayerName', 'FilterRTID', 'RemoteAddress',
    'RemotePort', 'LocalAddress', 'LocalPort'
  ];
  const data = {};
  for (const key of wanted) {
    if (Object.prototype.hasOwnProperty.call(event.data, key)) data[key] = event.data[key];
  }
  if (!Object.keys(data).length) Object.assign(data, event.data);
  return { source: event.source, provider: event.provider, eventId: event.eventId, time: event.time, recordId: event.recordId, data };
}

function countBy(events, keyFn) {
  const result = {};
  for (const event of events) {
    const key = String(keyFn(event));
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })));
}

const sourceFiles = {
  sysmon: 'sysmon-all-events.xml',
  security: 'security-target-events.xml',
  system: 'system-target-events.xml',
  application: 'application-target-events.xml',
  wer: 'wer-diag-events.xml',
  powershell: 'powershell-events.xml',
  dns: 'dns-client-events.xml',
  codeIntegrity: 'codeintegrity-events.xml'
};

const bySource = {};
for (const [source, name] of Object.entries(sourceFiles)) {
  bySource[source] = parseEvents(path.join(base, name), source);
}
const all = Object.values(bySource).flat();
const sysmon = bySource.sysmon;

const bundledPython = /\\codex-primary-runtime\\dependencies\\python\\python\.exe$/i;
const crashPids = new Set([11780, 12900]);
const crashCreates = sysmon.filter((event) => event.eventId === 1 && bundledPython.test(event.data.Image || '') && crashPids.has(numericPid(event.data.ProcessId)));
const crashGuids = new Set(crashCreates.map((event) => String(event.data.ProcessGuid || '').toLowerCase()).filter(Boolean));

const createByGuid = new Map(sysmon
  .filter((event) => event.eventId === 1 && event.data.ProcessGuid)
  .map((event) => [String(event.data.ProcessGuid).toLowerCase(), event]));

const childCreates = sysmon.filter((event) => event.eventId === 1 && crashGuids.has(String(event.data.ParentProcessGuid || '').toLowerCase()));
const childGuids = new Set(childCreates.map((event) => String(event.data.ProcessGuid || '').toLowerCase()).filter(Boolean));

const lineageGuids = new Set([...crashGuids, ...childGuids]);
for (const start of crashCreates) {
  let cursor = start;
  for (let depth = 0; cursor && depth < 12; depth += 1) {
    const guid = String(cursor.data.ProcessGuid || '').toLowerCase();
    if (guid) lineageGuids.add(guid);
    const parentGuid = String(cursor.data.ParentProcessGuid || '').toLowerCase();
    cursor = parentGuid ? createByGuid.get(parentGuid) : null;
  }
}

function relatesToGuid(event, set) {
  return ['ProcessGuid', 'ParentProcessGuid', 'SourceProcessGuid', 'TargetProcessGuid']
    .some((key) => set.has(String(event.data[key] || '').toLowerCase()));
}

const keyRegex = /(?:\bbtk\b|\bkbn\b|pypi|pythonhosted|pandas|numpy|python[-_ ]?dateutil|\bdateutil\b|tzdata|platform\.py|xlrd|werfault(?:\.exe)?|cmd\.exe|python\.exe)/i;
const btkRegex = /(?:\bbtk\b|\bkbn\b|btk-kbn)/i;
const registryRegex = /(?:pypi|pythonhosted)/i;
const packageRegex = /(?:pandas|numpy|python[-_ ]?dateutil|\bdateutil\b|tzdata|platform\.py|xlrd)/i;

const targetEvents = sysmon.filter((event) => relatesToGuid(event, new Set([...crashGuids, ...childGuids])));
const imageLoads = targetEvents.filter((event) => event.eventId === 7);
const imageLoadSummary = imageLoads.map((event) => ({
  time: event.time,
  processId: numericPid(event.data.ProcessId),
  processGuid: event.data.ProcessGuid || '',
  imageLoaded: event.data.ImageLoaded || '',
  hashes: event.data.Hashes || '',
  signed: event.data.Signed || '',
  signature: event.data.Signature || '',
  signatureStatus: event.data.SignatureStatus || ''
}));

function buildChain(start) {
  const chain = [];
  const seen = new Set();
  let cursor = start;
  while (cursor && chain.length < 12) {
    const guid = String(cursor.data.ProcessGuid || '').toLowerCase();
    if (seen.has(guid)) break;
    if (guid) seen.add(guid);
    chain.push(compact(cursor));
    const parentGuid = String(cursor.data.ParentProcessGuid || '').toLowerCase();
    cursor = parentGuid ? createByGuid.get(parentGuid) : null;
  }
  return chain;
}

const interestingCreates = all.filter((event) => [1, 4688].includes(event.eventId) && keyRegex.test(values(event)));
const btkEvents = all.filter((event) => btkRegex.test(values(event)));
const registryHostEvents = all.filter((event) => registryRegex.test(values(event)));
const packageEvents = all.filter((event) => packageRegex.test(values(event)));
const targetNetworkDns = targetEvents.filter((event) => [3, 22, 5156, 5157].includes(event.eventId));
const targetFileEvents = targetEvents.filter((event) => [11, 15, 23, 26].includes(event.eventId));
const targetTerminateEvents = targetEvents.filter((event) => [5, 4689].includes(event.eventId));

const btkFileCreates = sysmon.filter((event) => event.eventId === 11 && btkRegex.test(event.data.TargetFilename || ''));
const btkCreatorGuids = new Set(btkFileCreates.map((event) => String(event.data.ProcessGuid || '').toLowerCase()).filter(Boolean));
const btkCreatorEvents = sysmon.filter((event) => relatesToGuid(event, btkCreatorGuids));

const xlrdInstallerCreates = sysmon.filter((event) => event.eventId === 1 && /pip(?:\.exe)?\s+install[\s\S]*\bxlrd\b/i.test(event.data.CommandLine || ''));
const xlrdFileCreates = sysmon.filter((event) => event.eventId === 11 && /\\codex_xlrd(?:\\|$)/i.test(event.data.TargetFilename || ''));
const pypiDnsEvents = sysmon.filter((event) => event.eventId === 22 && registryRegex.test(event.data.QueryName || ''));
const pypiGuids = new Set([
  ...xlrdInstallerCreates.map((event) => String(event.data.ProcessGuid || '').toLowerCase()),
  ...xlrdFileCreates.map((event) => String(event.data.ProcessGuid || '').toLowerCase()),
  ...pypiDnsEvents.map((event) => String(event.data.ProcessGuid || '').toLowerCase())
].filter(Boolean));
const pypiCreatorEvents = sysmon.filter((event) => relatesToGuid(event, pypiGuids));

const allPythonCreates = sysmon.filter((event) => event.eventId === 1 && /\\python\.exe$/i.test(event.data.Image || ''));
const allPythonRuns = allPythonCreates.map((created) => {
  const guid = String(created.data.ProcessGuid || '').toLowerCase();
  const children = sysmon.filter((event) => event.eventId === 1 && String(event.data.ParentProcessGuid || '').toLowerCase() === guid);
  const ownEvents = sysmon.filter((event) => String(event.data.ProcessGuid || '').toLowerCase() === guid);
  return {
    created: compact(created),
    children: children.map(compact),
    terminated: ownEvents.filter((event) => event.eventId === 5).map(compact),
    networkDns: ownEvents.filter((event) => [3, 22].includes(event.eventId)).map(compact),
    fileEvents: ownEvents.filter((event) => [11, 15, 23, 26].includes(event.eventId)).map(compact)
  };
});

const report = {
  generatedUtc: new Date().toISOString(),
  method: 'Read-only parse of exported Windows event XML. Events are bound by Sysmon ProcessGuid when available to avoid PID reuse errors.',
  sourceDirectory: path.resolve(base),
  sourceEventCounts: Object.fromEntries(Object.entries(bySource).map(([source, events]) => [source, countBy(events, (event) => event.eventId)])),
  crashProcessIds: [...crashPids],
  crashProcessGuids: [...crashGuids],
  crashCreates: crashCreates.map(compact),
  crashProcessChains: crashCreates.map(buildChain),
  childCreates: childCreates.map(compact),
  lineageProcessGuids: [...lineageGuids],
  targetEventCounts: countBy(targetEvents, (event) => event.eventId),
  targetEvents: targetEvents.map(compact),
  targetImageLoadCount: imageLoadSummary.length,
  targetImageLoads: imageLoadSummary,
  targetNetworkDns: targetNetworkDns.map(compact),
  targetFileEvents: targetFileEvents.map(compact),
  targetTerminateEvents: targetTerminateEvents.map(compact),
  interestingProcessCreates: interestingCreates.map(compact),
  btkKbnEvents: btkEvents.map(compact),
  btkFileCreates: btkFileCreates.map(compact),
  btkCreatorProcessGuids: [...btkCreatorGuids],
  btkCreatorEvents: btkCreatorEvents.map(compact),
  pypiPythonhostedEvents: registryHostEvents.map(compact),
  xlrdInstallerCreates: xlrdInstallerCreates.map(compact),
  xlrdFileCreateCount: xlrdFileCreates.length,
  xlrdFileCreates: xlrdFileCreates.map(compact),
  pypiCreatorProcessGuids: [...pypiGuids],
  pypiCreatorEvents: pypiCreatorEvents.map(compact),
  allPythonRunCount: allPythonRuns.length,
  allPythonRuns,
  packageEvents: packageEvents.map(compact)
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  output: path.resolve(output),
  sourceCounts: Object.fromEntries(Object.entries(bySource).map(([name, events]) => [name, events.length])),
  crashCreates: crashCreates.length,
  childCreates: childCreates.length,
  targetEvents: targetEvents.length,
  targetImageLoads: imageLoadSummary.length,
  targetNetworkDns: targetNetworkDns.length,
  btkKbnEvents: btkEvents.length,
  btkCreatorEvents: btkCreatorEvents.length,
  pypiPythonhostedEvents: registryHostEvents.length,
  pypiCreatorEvents: pypiCreatorEvents.length,
  xlrdFileCreates: xlrdFileCreates.length,
  allPythonRuns: allPythonRuns.length,
  packageEvents: packageEvents.length
}, null, 2));
