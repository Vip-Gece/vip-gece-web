"use strict";

const { createClient } = require("@supabase/supabase-js");
const { hasSupabaseEnv } = require("../config/env");

let cachedClient = null;
let cachedServiceClient = null;

function getSupabaseClient() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }

  return cachedClient;
}

function getSupabaseClientForToken(token) {
  if (!hasSupabaseEnv() || !token) {
    return null;
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
}

function getSupabaseAuthClient() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}

function getSupabaseServiceClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  if (!cachedServiceClient) {
    cachedServiceClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
  }

  return cachedServiceClient;
}

module.exports = {
  getSupabaseClient,
  getSupabaseClientForToken,
  getSupabaseAuthClient,
  getSupabaseServiceClient
};
