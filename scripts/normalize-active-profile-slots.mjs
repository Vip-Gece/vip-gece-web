import "dotenv/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transaction } = require("../src/data/postgresClient");
const { sortProfiles } = require("../src/services/render/shared");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expectedCount = Number.parseInt(
  args.find((value) => value.startsWith("--expected-count="))?.split("=")[1] || "",
  10
);

if (!Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error("--expected-count=<positive integer> is required");
}

const plan = await transaction(async (client) => {
  await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
  const { rows } = await client.query(
    `select id, name, slug, type, is_active, vip_slot, normal_slot,
            priority_order, display_priority
     from public.profiles
     where is_active = true
     for update`
  );
  const ordered = sortProfiles(rows);
  if (ordered.length !== expectedCount) {
    throw new Error(`active profile count changed: expected ${expectedCount}, got ${ordered.length}`);
  }

  const changes = ordered.map((profile, index) => {
    const nextSlot = index + 1;
    return {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      type: profile.type === "normal" ? "normal" : "vip",
      previous_slot: Number(profile.vip_slot ?? profile.normal_slot) || null,
      next_slot: nextSlot
    };
  });

  if (!apply) return changes;

  for (const change of changes) {
    const vipSlot = change.type === "vip" ? change.next_slot : null;
    const normalSlot = change.type === "normal" ? change.next_slot : null;
    const result = await client.query(
      `update public.profiles
       set vip_slot = $2,
           normal_slot = $3,
           priority_order = $4,
           display_priority = $4,
           updated_at = now()
       where id = $1
         and is_active = true`,
      [change.id, vipSlot, normalSlot, change.next_slot]
    );
    if (result.rowCount !== 1) {
      throw new Error(`profile slot update failed for ${change.slug}`);
    }
  }

  return changes;
});

console.log(JSON.stringify({
  ok: true,
  mode: apply ? "applied" : "dry-run",
  active_profiles: plan.length,
  changes: plan.map(({ name, slug, previous_slot, next_slot }) => ({
    name,
    slug,
    previous_slot,
    next_slot
  }))
}, null, 2));
