'use strict';

const fs = require('fs');
const path = require('path');

const base = process.argv[2];
if (!base) {
  console.error('Usage: node parse-python-events.js <evidence-directory>');
  process.exit(2);
}

function readText(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8');
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeXml(value.replace(/<[^>]*>/g, '')).trim();
}

function redact(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/((?:api[_-]?key|token|password|passwd|secret|authorization)\s*[=:]\s*)[^\s"']+/gi, '$1<redacted>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1<redacted>');
}

function parseEvents(file) {
  const text = readText(file);
  const blocks = text.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) || [];
  return blocks.map((xml) => {
    const eventId = Number((xml.match(/<EventID(?:\s[^>]*)?>(\d+)<\/EventID>/i) || [])[1]);
    const provider = decodeXml((xml.match(/<Provider\s+Name=['"]([^'"]+)['"]/i) || [])[1] || '');
    const time = (xml.match(/<TimeCreated\s+SystemTime=['"]([^'"]+)['"]/i) || [])[1] || '';
    const recordId = Number((xml.match(/<EventRecordID>(\d+)<\/EventRecordID>/i) || [])[1]);
    const data = {};
    let unnamed = 0;
    const dataPattern = /<Data(?:\s+Name=['"]([^'"]+)['"])?[^>]*>([\s\S]*?)<\/Data>/gi;
    let match;
    while ((match = dataPattern.exec(xml)) !== null) {
      const key = match[1] || `Data${unnamed++}`;
      data[key] = redact(stripTags(match[2]));
    }
    return { provider, eventId, time, recordId, data };
  });
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = String(keyFn(item));
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
}

function relevantData(event) {
  const wanted = [
    'Image', 'NewProcessName', 'OriginalFileName', 'CommandLine',
    'ParentImage', 'ParentProcessName', 'ParentCommandLine',
    'ProcessId', 'NewProcessId', 'ParentProcessId', 'CreatorProcessId',
    'ProcessGuid', 'ParentProcessGuid', 'User', 'Hashes',
    'Initiated', 'Protocol', 'SourceIp', 'SourceHostname', 'SourcePort',
    'DestinationIp', 'DestinationHostname', 'DestinationPort',
    'Application', 'Direction', 'LayerName', 'FilterRTID',
    'ImageLoaded', 'TargetFilename', 'QueryName', 'QueryResults', 'QueryStatus'
  ];
  const selected = {};
  for (const name of wanted) {
    if (Object.prototype.hasOwnProperty.call(event.data, name)) selected[name] = event.data[name];
  }
  if (Object.keys(selected).length === 0) return event.data;
  return selected;
}

function compact(event) {
  return {
    provider: event.provider,
    eventId: event.eventId,
    time: event.time,
    recordId: event.recordId,
    data: relevantData(event)
  };
}

const files = {
  systemPopup: 'system-event-26.xml',
  application: 'application-fault-events.xml',
  security: 'security-process-network-events.xml',
  sysmon: 'sysmon-events.xml',
  wer: 'wer-operational-events.xml'
};

const parsed = {};
for (const [name, file] of Object.entries(files)) {
  const fullPath = path.join(base, file);
  parsed[name] = fs.existsSync(fullPath) ? parseEvents(fullPath) : [];
}

const all = Object.values(parsed).flat();
const processEvents = all.filter((event) => event.eventId === 1 || event.eventId === 4688);

function processImage(event) {
  return event.data.Image || event.data.NewProcessName || '';
}

function numericPid(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  const parsedPid = text.startsWith('0x') ? parseInt(text.slice(2), 16) : parseInt(text, 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}

const pythonCreates = processEvents.filter((event) => path.win32.basename(processImage(event)).toLowerCase() === 'python.exe');
const werFaultCreates = processEvents.filter((event) => {
  return path.win32.basename(processImage(event)).toLowerCase() === 'werfault.exe' &&
    /python\.exe$/i.test(event.data.ParentImage || event.data.ParentProcessName || '');
});

const crashPids = new Set();
for (const event of werFaultCreates) {
  const match = String(event.data.CommandLine || '').match(/(?:^|\s)-p\s+(\d+)(?:\s|$)/i);
  if (match) crashPids.add(Number(match[1]));
}

const crashPythonCreates = pythonCreates.filter((event) => {
  const pid = numericPid(event.data.ProcessId || event.data.NewProcessId);
  return crashPids.has(pid);
});

const crashProcessGuids = new Set(
  crashPythonCreates
    .map((event) => String(event.data.ProcessGuid || '').toLowerCase())
    .filter(Boolean)
);

const crashChildProcesses = parsed.sysmon
  .filter((event) => event.eventId === 1)
  .filter((event) => crashProcessGuids.has(String(event.data.ParentProcessGuid || '').toLowerCase()));

const crashNetworkDnsFileEvents = all.filter((event) => {
  if (![3, 11, 22, 5156, 5157].includes(event.eventId)) return false;
  const pid = numericPid(event.data.ProcessId || event.data.NewProcessId);
  const guid = String(event.data.ProcessGuid || '').toLowerCase();
  if (guid) return crashProcessGuids.has(guid);
  return crashPids.has(pid);
});

const allPythonNetworkDnsEvents = all.filter((event) => {
  if (![3, 22, 5156, 5157].includes(event.eventId)) return false;
  return /python\.exe$/i.test(event.data.Image || event.data.Application || '');
});

const sysmonProcessByGuid = new Map(
  parsed.sysmon
    .filter((event) => event.eventId === 1 && event.data.ProcessGuid)
    .map((event) => [String(event.data.ProcessGuid).toLowerCase(), event])
);

function chainNode(event) {
  const image = event.data.Image || '';
  const baseName = path.win32.basename(image).toLowerCase();
  const node = {
    time: event.time,
    image,
    processId: numericPid(event.data.ProcessId),
    parentProcessId: numericPid(event.data.ParentProcessId),
    user: event.data.User || ''
  };
  if (baseName === 'python.exe' || baseName === 'pwsh.exe') {
    node.commandLine = String(event.data.CommandLine || '').slice(0, 1600);
  }
  return node;
}

function buildChain(start) {
  const chain = [];
  const seen = new Set();
  let event = start;
  while (event && chain.length < 12) {
    const guid = String(event.data.ProcessGuid || '').toLowerCase();
    if (guid && seen.has(guid)) break;
    if (guid) seen.add(guid);
    chain.push(chainNode(event));
    const parentGuid = String(event.data.ParentProcessGuid || '').toLowerCase();
    event = parentGuid ? sysmonProcessByGuid.get(parentGuid) : null;
  }
  return chain;
}

const report = {
  sourceDirectory: path.resolve(base),
  eventCounts: Object.fromEntries(Object.entries(parsed).map(([name, events]) => [name, countBy(events, (event) => event.eventId)])),
  crashPids: [...crashPids].sort((a, b) => a - b),
  crashPythonProcesses: crashPythonCreates.map(compact),
  crashProcessChains: crashPythonCreates
    .filter((event) => event.provider === 'Microsoft-Windows-Sysmon')
    .map(buildChain),
  crashChildProcesses: crashChildProcesses.map(compact),
  crashWerFaultProcesses: werFaultCreates.map(compact),
  crashNetworkDnsFileEvents: crashNetworkDnsFileEvents.map(compact),
  allPythonNetworkDnsEvents: allPythonNetworkDnsEvents.map(compact),
  pythonProcessCreateCount: pythonCreates.length,
  systemPopupEvents: parsed.systemPopup.map(compact)
};

console.log(JSON.stringify(report, null, 2));
