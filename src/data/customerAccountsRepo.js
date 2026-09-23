"use strict";

const { query, transaction } = require("./postgresClient");

function usePostgresCustomerAccounts() {
  const backend = process.env.CUSTOMER_ACCOUNT_STORE_BACKEND || "json";
  if (backend !== "json" && backend !== "postgres") {
    throw Object.assign(new Error("Customer account storage backend is not configured correctly."), {
      status: 503,
      code: "CUSTOMER_ACCOUNT_BACKEND_INVALID"
    });
  }
  return backend === "postgres";
}

async function readCustomerAccounts() {
  const result = await query("select data from private.customer_accounts order by id");
  return { version: 1, accounts: result.rows.map(row => row.data) };
}

async function mutateCustomerAccounts(callback) {
  return transaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["vip-gece-customer-accounts"]);
    const result = await client.query("select data from private.customer_accounts order by id for update");
    const accounts = result.rows.map(row => row.data);
    if (accounts.some(account => !account || typeof account !== "object" || Array.isArray(account))) {
      throw Object.assign(new Error("Customer account store is invalid."), {
        status: 503,
        code: "CUSTOMER_ACCOUNT_STORE_INVALID"
      });
    }
    const before = new Map(accounts.map(account => [account.id, JSON.stringify(account)]));
    const store = { version: 1, accounts };
    const output = await callback(store);
    for (const account of store.accounts) {
      const data = JSON.stringify(account);
      if (before.get(account.id) === data) continue;
      await client.query(
        `insert into private.customer_accounts (id, email, username, data)
         values ($1, $2, $3, $4::jsonb)
         on conflict (id) do update set email = excluded.email,
           username = excluded.username, data = excluded.data`,
        [account.id, account.email, account.username || null, data]
      );
    }
    return output;
  });
}

module.exports = { usePostgresCustomerAccounts, readCustomerAccounts, mutateCustomerAccounts };
