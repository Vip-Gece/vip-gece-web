#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const { Client } = require(path.join(repoRoot, "node_modules", "pg"));
const {
  databaseConnectionString,
  databaseSslConfig
} = require(path.join(repoRoot, "src", "data", "postgresClient.js"));
const wantedIds = new Set(["79", "80", "81", "82", "83", "84"]);

function int64FromHex(hex) {
  if (!hex || hex.length !== 16) return "";
  let value = BigInt(`0x${hex}`);
  if (value >= (1n << 63n)) value -= 1n << 64n;
  return value.toString();
}

function textFromHex(hex) {
  if (!hex) return "";
  return Buffer.from(hex, "hex").toString("utf8").replaceAll("\u0000", "").trim();
}

async function extensionInstalled(client) {
  const result = await client.query(
    "select exists(select 1 from pg_extension where extname = 'pageinspect') as installed"
  );
  return result.rows[0]?.installed === true;
}

async function main() {
  const client = new Client({
    connectionString: databaseConnectionString(),
    ssl: databaseSslConfig(),
    connectionTimeoutMillis: 8_000,
    statement_timeout: 10_000,
    query_timeout: 15_000
  });
  await client.connect();
  const installedBefore = await extensionInstalled(client);
  let recovered = [];

  try {
    await client.query("begin");
    if (!installedBefore) {
      await client.query("create extension pageinspect with schema extensions");
    }
    await client.query("set local search_path = public, extensions");
    const sizeResult = await client.query(`
      select ceil(pg_relation_size('public.profiles')::numeric / current_setting('block_size')::int)::int as blocks
    `);
    const blocks = Number(sizeResult.rows[0]?.blocks || 0);
    const candidates = [];

    for (let page = 0; page < blocks; page += 1) {
      const result = await client.query(`
        select
          $1::int as page,
          lp,
          t_xmin::text,
          t_xmax::text,
          t_infomask,
          t_infomask2,
          encode(t_attrs[1], 'hex') as id_hex,
          encode(t_attrs[4], 'hex') as name_hex,
          encode(t_attrs[6], 'hex') as slug_hex
        from heap_page_item_attrs(
          get_raw_page('public.profiles', $1),
          'public.profiles'::regclass,
          true
        )
        where t_attrs[1] is not null
      `, [page]);
      candidates.push(...result.rows);
    }

    recovered = candidates
      .map((row) => ({
        id: int64FromHex(row.id_hex),
        name: textFromHex(row.name_hex),
        slug: textFromHex(row.slug_hex),
        page: row.page,
        line_pointer: row.lp,
        xmin: row.t_xmin,
        xmax: row.t_xmax,
        infomask: row.t_infomask,
        infomask2: row.t_infomask2
      }))
      .filter((row) => wantedIds.has(row.id));
  } finally {
    await client.query("rollback").catch(() => {});
  }

  const installedAfter = await extensionInstalled(client);
  await client.end();
  console.log(JSON.stringify({ installed_before: installedBefore, installed_after: installedAfter, recovered }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
