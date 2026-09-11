import { readFile } from "node:fs/promises";

const TRACKER_URL = new URL(
  "../docs/external/backlink-tracker-vip-gece.csv",
  import.meta.url
);

const EXPECTED_HEADERS = [
  "date",
  "source_domain",
  "submission_url",
  "target_url",
  "anchor",
  "link_type",
  "category",
  "status",
  "index_status",
  "quality_note",
  "risk_note",
  "evidence_url",
  "last_checked"
];

const CANONICAL_PREFIX = "https://vip-gece.site/";
const FIRST_PARTY_DOMAINS = new Set([
  "vip-gece.site",
  "vip-gece.com",
  "vip-gece.online"
]);
const VERIFIED_STATUS = "published-independent-verified";
const DISALLOWED_EDITORIAL_ANCHOR = /\b(?:orospu|sik|sikiş|amcık|amına|fahişe)\b/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  assert(!quoted, "tracker contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value !== ""));
}

function recordFrom(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

function sourceHost(record) {
  return String(record.source_domain || "").trim().toLowerCase().replace(/^www\./, "");
}

function validateEditorialPending(record, rowNumber) {
  const label = `row ${rowNumber} (${record.source_domain})`;
  assert(record.anchor === "editorial-discretion", `${label}: pending editorial anchor must remain editorial-discretion`);
  assert(record.link_type === "unknown", `${label}: pending editorial link type must remain unknown`);
  assert(record.index_status === "pending", `${label}: pending editorial index status must remain pending`);
  assert(record.target_url.startsWith(CANONICAL_PREFIX), `${label}: editorial target must use canonical .site`);
  assert(!FIRST_PARTY_DOMAINS.has(sourceHost(record)), `${label}: editorial source must be independent`);
  assert(/^https:\/\//.test(record.submission_url), `${label}: submission URL must use HTTPS`);
  assert(/^https:\/\//.test(record.evidence_url), `${label}: evidence URL must use HTTPS`);
  assert(record.quality_note.length >= 80, `${label}: quality note is too weak`);
  assert(record.risk_note.length >= 60, `${label}: risk note is too weak`);
  assert(/do not count|no publication|unconfirmed/i.test(record.risk_note), `${label}: risk note must explicitly reject a publication claim`);
  assert(!DISALLOWED_EDITORIAL_ANCHOR.test(record.anchor), `${label}: rough-language anchor is forbidden`);
}

function validateVerifiedPublication(record, rowNumber) {
  const label = `row ${rowNumber} (${record.source_domain})`;
  assert(!FIRST_PARTY_DOMAINS.has(sourceHost(record)), `${label}: verified publication must be independent`);
  assert(record.target_url.startsWith(CANONICAL_PREFIX), `${label}: verified backlink must target canonical .site`);
  assert(record.index_status === "indexable-verified", `${label}: verified publication requires indexable-verified status`);
  assert(["follow", "nofollow", "ugc"].includes(record.link_type), `${label}: rel/link type must be recorded explicitly`);
  assert(record.anchor && record.anchor !== "editorial-discretion", `${label}: live anchor text must be recorded`);
  assert(/^https:\/\//.test(record.evidence_url), `${label}: live source evidence must use HTTPS`);
  assert(/http 200/i.test(record.quality_note), `${label}: quality note must record HTTP 200`);
  assert(/outbound/i.test(record.quality_note), `${label}: quality note must record the outbound link check`);
  assert(/rel=/i.test(record.risk_note), `${label}: risk note must record rel attributes`);
  assert(!/paid|reciprocal/i.test(record.risk_note), `${label}: paid or reciprocal publication cannot be verified editorial proof`);
  assert(!DISALLOWED_EDITORIAL_ANCHOR.test(record.anchor), `${label}: rough-language live anchor is forbidden`);
}

const parserFixture = parseCsv('a,b,c\n1,"two, parts","quote ""ok"""\n');
assert(parserFixture.length === 2, "CSV parser fixture row count failed");
assert(parserFixture[1][1] === "two, parts", "CSV parser fixture comma handling failed");
assert(parserFixture[1][2] === 'quote "ok"', "CSV parser fixture quote handling failed");

const rows = parseCsv(await readFile(TRACKER_URL, "utf8"));
assert(rows.length > 1, "backlink tracker has no evidence rows");

const headers = rows.shift();
assert(
  JSON.stringify(headers) === JSON.stringify(EXPECTED_HEADERS),
  `tracker headers must be exactly: ${EXPECTED_HEADERS.join(",")}`
);

const records = rows.map((values, index) => {
  assert(values.length === headers.length, `row ${index + 2}: expected ${headers.length} columns, found ${values.length}`);
  const record = recordFrom(headers, values);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(record.date), `row ${index + 2}: invalid date`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(record.last_checked), `row ${index + 2}: invalid last_checked date`);
  assert(record.source_domain, `row ${index + 2}: source_domain is required`);
  assert(record.status, `row ${index + 2}: status is required`);
  return record;
});

const uniqueKeys = new Set();
for (const [index, record] of records.entries()) {
  const rowNumber = index + 2;
  const key = [record.date, record.source_domain, record.submission_url, record.status].join("|");
  assert(!uniqueKeys.has(key), `row ${rowNumber}: duplicate tracker evidence key`);
  uniqueKeys.add(key);

  if (record.status.startsWith("editorial-")) {
    validateEditorialPending(record, rowNumber);
  }
  if (record.status === VERIFIED_STATUS) {
    validateVerifiedPublication(record, rowNumber);
  }
}

const editorialPending = records.filter((record) => record.status.startsWith("editorial-")).length;
const independentlyVerified = records.filter((record) => record.status === VERIFIED_STATUS).length;

console.log(`backlink evidence contract passed: rows=${records.length} editorial_pending=${editorialPending} independent_verified=${independentlyVerified}`);
