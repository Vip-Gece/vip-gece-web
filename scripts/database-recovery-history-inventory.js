#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const { query } = require(path.join(repoRoot, "src", "data", "postgresClient.js"));

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  const tablesResult = await query(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema')
      and table_type = 'BASE TABLE'
    order by table_schema, table_name
  `);
  const candidatePattern = /(profile|customer|audit|event|history|deleted|backup|media|image)/i;
  const candidates = tablesResult.rows.filter((row) => candidatePattern.test(row.table_name));
  const tables = [];

  for (const table of candidates) {
    const columnsResult = await query(`
      select column_name, data_type
      from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position
    `, [table.table_schema, table.table_name]);
    const countResult = await query(
      `select count(*)::bigint as count from ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`
    );
    tables.push({
      schema: table.table_schema,
      table: table.table_name,
      row_count: Number(countResult.rows[0]?.count || 0),
      columns: columnsResult.rows
    });
  }

  const recoveryEvents = await query(`
    select
      profile_id::text as profile_id,
      max(nullif(profile_name, '')) as profile_name,
      max(nullif(profile_slug, '')) as profile_slug,
      count(*)::bigint as event_count,
      min(created_at) as first_event_at,
      max(created_at) as last_event_at
    from public.analytics_events
    where profile_id = any($1::bigint[])
    group by profile_id
    order by profile_id
  `, [[79, 80, 81, 82, 83, 84]]);
  const profileTableStats = await query(`
    select
      n_live_tup::bigint as live_rows,
      n_dead_tup::bigint as dead_rows,
      last_vacuum,
      last_autovacuum,
      vacuum_count::bigint,
      autovacuum_count::bigint
    from pg_stat_user_tables
    where schemaname = 'public' and relname = 'profiles'
  `);
  const extensions = await query(`
    select
      available.name,
      available.default_version,
      installed.extversion as installed_version
    from pg_available_extensions available
    left join pg_extension installed on installed.extname = available.name
    where available.name in ('pageinspect', 'pg_walinspect', 'pg_dirtyread')
    order by available.name
  `);

  console.log(JSON.stringify({
    candidate_table_count: tables.length,
    tables,
    recovery_profile_events: recoveryEvents.rows,
    profile_table_stats: profileTableStats.rows,
    recovery_extensions: extensions.rows
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
