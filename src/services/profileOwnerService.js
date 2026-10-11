"use strict";

const { hasDatabaseUrl, transaction } = require("../data/postgresClient");
const { getPostgresProfileById, clearPostgresProfileCache } = require("../data/postgresProfilesRepo");
const { getCustomerMobileAccount, listCustomerMobileAccounts } = require("./customerMobileAccountService");

async function validateProfileOwner(payload, profileId = "") {
  if (!Object.prototype.hasOwnProperty.call(payload, "owner_user_id")) return null;
  const owner = payload.owner_user_id;
  if (owner === null || owner === "") {
    payload.owner_user_id = null;
    return null;
  }

  const match = String(owner).match(/^customer:([a-zA-Z0-9-]{1,80})$/);
  const account = match ? await getCustomerMobileAccount(match[1], { requireExistingStore: true }) : null;
  if (!account) {
    // Only an unchanged, deleted relationship may fall back to site management.
    // New assignments and account-store read failures must still fail closed.
    if (match && profileId && hasDatabaseUrl()) {
      const current = await getPostgresProfileById(profileId);
      if (current?.owner_user_id === owner) {
        payload.owner_user_id = null;
        return null;
      }
    }
    throw Object.assign(new Error("Seçilen müşteri hesabı bulunamadı."), { status: 400 });
  }

  if (!hasDatabaseUrl()) {
    throw Object.assign(new Error("Müşteri profil sahipliği için PostgreSQL gerekli."), { status: 503 });
  }
  payload.owner_user_id = account.owner_user_id;
  return account;
}

async function reconcileOrphanProfileOwners() {
  if (!hasDatabaseUrl()) return [];
  // Reading and validating the authoritative account store is mandatory even
  // when it contains no accounts. An unavailable store must never mean empty.
  await listCustomerMobileAccounts({ requireExistingStore: true });
  const changed = await transaction(async client => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
    // Keep new assignments from entering between the account snapshot and update.
    await client.query("lock table public.profiles in share row exclusive mode");
    const accounts = await listCustomerMobileAccounts({ requireExistingStore: true });
    const owners = accounts.map(account => account.owner_user_id);
    const result = await client.query(
      `update public.profiles set owner_user_id = null
       where (owner_user_id like 'customer:%' and not (owner_user_id = any($1::text[])))
          or owner_user_id = ''
       returning id`,
      [owners]
    );
    return result.rows.map(row => row.id);
  });
  if (changed.length) clearPostgresProfileCache();
  return changed;
}

function startProfileOwnerMaintenance() {
  if (process.env.NODE_ENV !== "production" || !hasDatabaseUrl()) return () => {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const changed = await reconcileOrphanProfileOwners();
      if (changed.length) console.log(`Profile ownership reconciled: ${changed.length}`);
    } catch {
      console.error("Profile ownership reconciliation deferred: account/database check failed.");
    } finally { running = false; }
  };
  const initial = setTimeout(run, 1000);
  const timer = setInterval(run, 5 * 60 * 1000);
  initial.unref(); timer.unref();
  return () => { clearTimeout(initial); clearInterval(timer); };
}

module.exports = { validateProfileOwner, reconcileOrphanProfileOwners, startProfileOwnerMaintenance };
