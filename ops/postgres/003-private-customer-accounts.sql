BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.customer_accounts (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  username text UNIQUE,
  data jsonb NOT NULL,
  CONSTRAINT customer_account_identity_matches CHECK (
    data->>'id' IS NOT NULL AND data->>'id' = id AND
    data->>'email' IS NOT NULL AND data->>'email' = email
  )
);
ALTER TABLE private.customer_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_accounts FROM PUBLIC, anon, authenticated;
COMMIT;
