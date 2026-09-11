"use strict";

const crypto = require("crypto");
const { hasDatabaseUrl, query, transaction } = require("../data/postgresClient");
const { safeSlug } = require("../utils/text");
const { verifyAnalyticsEventProof } = require("./analyticsEventProofService");

const TIMEZONE = "Europe/Istanbul";
const EVENT_TYPES = new Set(["profile_view", "contact_click"]);
const SOURCES = new Set([
  "direct",
  "google",
  "bing",
  "yandex",
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "telegram",
  "internal",
  "referral",
  "unknown"
]);
const CONTACT_CHANNELS = new Set(["whatsapp", "phone", "telegram"]);
const ANALYTICS_PERIODS = new Set([1, 7, 30, 90]);
const CUSTOMER_OWNER_PATTERN = /^customer:[a-zA-Z0-9-]{1,80}$/;

const TRACKING_STARTED_EVENT = "vip_gece_tracking_started";
let storageReady;

function analyticsError(message, status = 503, code = "ANALYTICS_UNAVAILABLE") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function ensureProfileAnalyticsStorage() {
  if (!hasDatabaseUrl()) {
    throw analyticsError("Analiz veritabanı hazır değil.");
  }
  if (!storageReady) {
    storageReady = query(
      `
        insert into public.analytics_events (
          id,
          event_type,
          event_id,
          timezone,
          bot
        )
        select
          $1::bigint,
          $2,
          $3,
          $4,
          false
        where not exists (
          select 1
          from public.analytics_events
          where event_type = $2
        )
      `,
      [analyticsEventId(), TRACKING_STARTED_EVENT, crypto.randomUUID(), TIMEZONE]
    ).catch((error) => {
      storageReady = undefined;
      throw error;
    });
  }
  await storageReady;
}

function analyticsEventId() {
  const value = crypto.randomBytes(8).readBigUInt64BE() & 0x7fffffffffffffffn;
  return (value || 1n).toString();
}

function normalizeEvent(input = {}) {
  const allowedKeys = new Set([
    "event_type",
    "profile_slug",
    "source",
    "channel",
    "lead_reference",
    "event_id",
    "proof"
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw analyticsError("Analiz olayı alanları geçersiz.", 400, "INVALID_ANALYTICS_EVENT");
  }

  const eventType = String(input.event_type || "").trim().toLowerCase();
  const profileSlug = safeSlug(input.profile_slug || "");
  const source = String(input.source || "unknown").trim().toLowerCase();
  const channel = String(input.channel || "none").trim().toLowerCase();
  const leadReference = String(input.lead_reference || "").trim().toUpperCase();
  const eventId = String(input.event_id || "").trim().toLowerCase();
  const proof = String(input.proof || "").trim();

  if (!EVENT_TYPES.has(eventType) || !profileSlug || !SOURCES.has(source)) {
    throw analyticsError("Analiz olayı geçersiz.", 400, "INVALID_ANALYTICS_EVENT");
  }
  if (
    (eventType === "profile_view" && channel !== "none") ||
    (eventType === "contact_click" && !CONTACT_CHANNELS.has(channel)) ||
    (leadReference && (eventType !== "contact_click" || channel !== "whatsapp" || !/^VG-[A-Z0-9]{12}$/.test(leadReference)))
  ) {
    throw analyticsError("Analiz olayı kanalı geçersiz.", 400, "INVALID_ANALYTICS_EVENT");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(eventId)) {
    throw analyticsError("Analiz olayı kimliği geçersiz.", 400, "INVALID_ANALYTICS_EVENT");
  }
  if (!proof || proof.length > 320) {
    throw analyticsError("Analiz sayfa kanıtı geçersiz.", 400, "INVALID_ANALYTICS_PROOF");
  }

  return { eventType, profileSlug, source, channel, leadReference, eventId, proof };
}

async function recordProfileAnalyticsEvent(input = {}) {
  const event = normalizeEvent(input);
  await ensureProfileAnalyticsStorage();

  const rows = await transaction(async (client) => {
    const target = await client.query(
      `
        select id, name, owner_user_id
        from public.profiles
        where slug = $1
          and is_active = true
        limit 1
        for share
      `,
      [event.profileSlug]
    );
    const profile = target.rows[0];
    if (!profile) return [];
    if (!verifyAnalyticsEventProof(event.proof, profile.id, event.eventType, event.eventId)) {
      throw analyticsError("Analiz sayfa kanıtı geçersiz.", 400, "INVALID_ANALYTICS_PROOF");
    }
    const profilePath = `/profil/${event.profileSlug}${event.leadReference ? `?ref=${encodeURIComponent(event.leadReference)}` : ""}`;

    const inserted = await client.query(
      `
        insert into public.analytics_events (
          id,
          event_type,
          profile_id,
          owner_user_id_snapshot,
          page_url,
          event_id,
          path,
          source,
          profile_slug,
          profile_name,
          action,
          timezone,
          bot
        )
        values (
          $1::bigint,
          $2,
          $3::bigint,
          $4,
          $5,
          $6,
          $5,
          $7,
          $8,
          $9,
          $10,
          $11,
          false
        )
        on conflict (event_id) where event_id is not null do nothing
        returning profile_id
      `,
      [
        analyticsEventId(),
        event.eventType,
        profile.id,
        profile.owner_user_id || null,
        profilePath,
        event.eventId,
        event.source,
        event.profileSlug,
        String(profile.name || "").slice(0, 120),
        event.channel,
        TIMEZONE
      ]
    );
    return inserted.rows;
  });

  return {
    tracked: rows.length === 1,
    event_type: event.eventType,
    lead_reference: event.leadReference
  };
}

function summaryId(ownerUserId, reportDate) {
  return crypto
    .createHash("sha256")
    .update(`vip-gece-daily-v1:${ownerUserId}:${reportDate}`)
    .digest("base64url")
    .slice(0, 32);
}

async function getCustomerDailyAnalytics(ownerUserId) {
  const owner = String(ownerUserId || "").trim();
  if (!owner) throw analyticsError("Müşteri analiz kapsamı geçersiz.", 400);
  await ensureProfileAnalyticsStorage();

  const { rows } = await query(
    `
      with report as (
        select
          ((now() at time zone '${TIMEZONE}')::date - 1) as report_date,
          min(created_at) filter (
            where owner_user_id_snapshot = $1
              and event_type in ('profile_view', 'contact_click')
              and coalesce(bot, false) = false
          ) as tracking_started_at
        from public.analytics_events
      ),
      scoped as (
        select
          events.profile_id,
          events.event_type,
          coalesce(nullif(events.source, ''), 'unknown') as source,
          coalesce(nullif(events.action, ''), 'none') as channel,
          count(*)::bigint as event_count
        from public.analytics_events events
        join public.profiles profiles
          on profiles.id::bigint = events.profile_id
        cross join report
        where profiles.owner_user_id = $1
          and events.owner_user_id_snapshot = $1
          and events.event_type in ('profile_view', 'contact_click')
          and coalesce(events.bot, false) = false
          and events.created_at >=
            (report.report_date::timestamp at time zone '${TIMEZONE}')
          and events.created_at <
            ((report.report_date + 1)::timestamp at time zone '${TIMEZONE}')
        group by
          events.profile_id,
          events.event_type,
          coalesce(nullif(events.source, ''), 'unknown'),
          coalesce(nullif(events.action, ''), 'none')
      )
      select
        report.report_date::text,
        report.tracking_started_at,
        coalesce((
          report.tracking_started_at <=
          (report.report_date::timestamp at time zone '${TIMEZONE}')
        ), false) as complete,
        coalesce(sum(event_count) filter (where event_type = 'profile_view'), 0)::bigint
          as profile_views,
        coalesce(sum(event_count) filter (where event_type = 'contact_click'), 0)::bigint
          as contact_clicks,
        coalesce(sum(event_count) filter (
          where event_type = 'contact_click' and channel = 'whatsapp'
        ), 0)::bigint as whatsapp_clicks,
        coalesce(sum(event_count) filter (
          where event_type = 'contact_click' and channel = 'phone'
        ), 0)::bigint as phone_clicks,
        coalesce(sum(event_count) filter (
          where event_type = 'contact_click' and channel = 'telegram'
        ), 0)::bigint as telegram_clicks
      from report
      left join scoped on true
      group by report.report_date, report.tracking_started_at
    `,
    [owner]
  );

  const row = rows[0];
  if (!row) throw analyticsError("Günlük analiz özeti hazırlanamadı.");
  const reportDate = row.report_date;
  const complete = row.complete === true;
  return {
    status: complete ? "ready" : "unavailable",
    complete,
    summary_id: complete ? summaryId(owner, reportDate) : "",
    report_date: reportDate,
    timezone: TIMEZONE,
    generated_at: new Date().toISOString(),
    tracking_started_at: row.tracking_started_at
      ? new Date(row.tracking_started_at).toISOString()
      : "",
    coverage_status: complete
      ? "complete"
      : row.tracking_started_at
        ? "tracking_not_started_for_full_day"
        : "tracking_not_started",
    totals: {
      profile_views: Number(row.profile_views || 0),
      contact_clicks: Number(row.contact_clicks || 0)
    },
    channels: {
      whatsapp: Number(row.whatsapp_clicks || 0),
      phone: Number(row.phone_clicks || 0),
      telegram: Number(row.telegram_clicks || 0)
    }
  };
}

function normalizeAdminAnalyticsInput(input = {}) {
  const requestedDays = Number.parseInt(input.days, 10);
  const days = [1, 7, 30, 90].includes(requestedDays) ? requestedDays : 7;
  const rawProfileId = String(input.profile_id ?? input.profileId ?? "").trim();
  const ownerUserId = String(input.ownerUserId || "").trim();
  if (rawProfileId && !/^\d{1,20}$/.test(rawProfileId)) {
    throw analyticsError("Analiz profil kimliği geçersiz.", 400, "INVALID_ANALYTICS_PROFILE");
  }
  if (ownerUserId && !/^customer:[a-z0-9][a-z0-9._:-]{0,79}$/i.test(ownerUserId)) {
    throw analyticsError("Analiz müşteri kapsamı geçersiz.", 400, "INVALID_ANALYTICS_CUSTOMER");
  }
  if (rawProfileId && ownerUserId) {
    throw analyticsError("Tek seferde profil veya müşteri kapsamından biri seçilebilir.", 400, "INVALID_ANALYTICS_SCOPE");
  }
  return {
    days,
    profileId: rawProfileId || null,
    ownerUserId: ownerUserId || null
  };
}

function normalizeCustomerAnalyticsInput(input = {}) {
  const ownerUserId = String(input.owner_user_id ?? input.ownerUserId ?? "").trim();
  const profileId = String(input.profile_id ?? input.profileId ?? "").trim();
  const rawDays = String(input.days ?? "7").trim();
  const days = Number.parseInt(rawDays, 10);

  if (
    !CUSTOMER_OWNER_PATTERN.test(ownerUserId) ||
    !/^\d{1,20}$/.test(profileId)
  ) {
    throw analyticsError(
      "Analiz profili bulunamadı.",
      404,
      "ANALYTICS_PROFILE_NOT_FOUND"
    );
  }
  if (!/^\d{1,3}$/.test(rawDays) || !ANALYTICS_PERIODS.has(days)) {
    throw analyticsError(
      "Analiz dönemi geçersiz.",
      400,
      "INVALID_ANALYTICS_PERIOD"
    );
  }

  return { days, ownerUserId, profileId };
}

function assertCustomerAnalyticsScope(profile, input = {}) {
  const ownerUserId = String(input.owner_user_id ?? input.ownerUserId ?? "").trim();
  const profileId = String(input.profile_id ?? input.profileId ?? "").trim();
  if (
    !profile ||
    String(profile.id) !== profileId ||
    String(profile.owner_user_id || "") !== ownerUserId
  ) {
    throw analyticsError(
      "Analiz profili bulunamadı.",
      404,
      "ANALYTICS_PROFILE_NOT_FOUND"
    );
  }
  return profile;
}

async function getCustomerProfileAnalytics(input = {}) {
  const { days, ownerUserId, profileId } = normalizeCustomerAnalyticsInput(input);
  await ensureProfileAnalyticsStorage();

  const profileResult = await query(
    `select id, name, slug, owner_user_id, is_active
     from public.profiles
     where id = $1::bigint
       and owner_user_id = $2
     limit 1`,
    [profileId, ownerUserId]
  );
  const selectedProfile = assertCustomerAnalyticsScope(profileResult.rows[0], {
    ownerUserId,
    profileId
  });
  const filterParams = [days, profileId, ownerUserId];
  const [summaryResult, dailyResult, sourceResult] = await Promise.all([
    query(
      `
        with boundary as (
          select
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1)) as start_date,
            (now() at time zone '${TIMEZONE}')::date as end_date
        )
        select
          boundary.start_date::text,
          boundary.end_date::text,
          (
            select min(created_at)
            from public.analytics_events
            where profile_id = $2::bigint
              and owner_user_id_snapshot = $3
              and event_type in ('profile_view', 'contact_click')
              and coalesce(bot, false) = false
          ) as tracking_started_at,
          count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
          count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'whatsapp'
          )::bigint as whatsapp_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'phone'
          )::bigint as phone_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'telegram'
          )::bigint as telegram_clicks
        from boundary
        left join public.profiles profiles
          on profiles.id = $2::bigint
          and profiles.owner_user_id = $3
        left join public.analytics_events events
          on events.profile_id = profiles.id::bigint
          and events.owner_user_id_snapshot = $3
          and events.created_at >=
            (boundary.start_date::timestamp at time zone '${TIMEZONE}')
          and events.created_at <
            ((boundary.end_date + 1)::timestamp at time zone '${TIMEZONE}')
          and events.event_type in ('profile_view', 'contact_click')
          and coalesce(events.bot, false) = false
        group by boundary.start_date, boundary.end_date
      `,
      filterParams
    ),
    query(
      `
        with days as (
          select generate_series(
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp,
            (now() at time zone '${TIMEZONE}')::date::timestamp,
            interval '1 day'
          )::date as report_date
        ),
        scoped as (
          select
            (events.created_at at time zone '${TIMEZONE}')::date as report_date,
            count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
            count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks
          from public.analytics_events events
          join public.profiles profiles
            on profiles.id::bigint = events.profile_id
          where profiles.id = $2::bigint
            and profiles.owner_user_id = $3
            and events.owner_user_id_snapshot = $3
            and events.created_at >= (
              ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp
              at time zone '${TIMEZONE}'
            )
            and events.created_at < (
              ((now() at time zone '${TIMEZONE}')::date + 1)::timestamp
              at time zone '${TIMEZONE}'
            )
            and events.event_type in ('profile_view', 'contact_click')
            and coalesce(events.bot, false) = false
          group by (events.created_at at time zone '${TIMEZONE}')::date
        )
        select
          days.report_date::text as date,
          coalesce(scoped.profile_views, 0)::bigint as profile_views,
          coalesce(scoped.contact_clicks, 0)::bigint as contact_clicks
        from days
        left join scoped using (report_date)
        order by days.report_date
      `,
      filterParams
    ),
    query(
      `
        select
          coalesce(nullif(events.source, ''), 'unknown') as source,
          count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
          count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks
        from public.analytics_events events
        join public.profiles profiles
          on profiles.id::bigint = events.profile_id
        where profiles.id = $2::bigint
          and profiles.owner_user_id = $3
          and events.owner_user_id_snapshot = $3
          and events.created_at >= (
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.created_at < (
            ((now() at time zone '${TIMEZONE}')::date + 1)::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.event_type in ('profile_view', 'contact_click')
          and coalesce(events.bot, false) = false
        group by coalesce(nullif(events.source, ''), 'unknown')
        order by
          count(*) filter (where events.event_type = 'profile_view') desc,
          count(*) filter (where events.event_type = 'contact_click') desc,
          source
      `,
      filterParams
    )
  ]);

  const summary = summaryResult.rows[0] || {};
  const profileViews = Number(summary.profile_views || 0);
  const contactClicks = Number(summary.contact_clicks || 0);
  const trackingStartedAt = summary.tracking_started_at
    ? new Date(summary.tracking_started_at).toISOString()
    : "";
  const startBoundary = summary.start_date
    ? new Date(`${summary.start_date}T00:00:00+03:00`)
    : null;
  const coverageComplete = Boolean(
    trackingStartedAt &&
    startBoundary &&
    new Date(trackingStartedAt) <= startBoundary
  );

  return {
    ok: true,
    metric_scope: "site_interaction",
    metric_label: "Site etkileşimi",
    generated_at: new Date().toISOString(),
    timezone: TIMEZONE,
    period: {
      days,
      start_date: summary.start_date || "",
      end_date: summary.end_date || ""
    },
    coverage: {
      status: trackingStartedAt
        ? coverageComplete ? "complete" : "partial"
        : "not_started",
      complete: coverageComplete,
      tracking_started_at: trackingStartedAt
    },
    profile: {
      id: selectedProfile.id,
      name: selectedProfile.name || "",
      slug: selectedProfile.slug || "",
      is_active: selectedProfile.is_active === true
    },
    totals: {
      profile_views: profileViews,
      contact_clicks: contactClicks,
      action_rate: profileViews
        ? Number(((contactClicks / profileViews) * 100).toFixed(2))
        : 0
    },
    channels: {
      whatsapp: Number(summary.whatsapp_clicks || 0),
      phone: Number(summary.phone_clicks || 0),
      telegram: Number(summary.telegram_clicks || 0)
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      profile_views: Number(row.profile_views || 0),
      contact_clicks: Number(row.contact_clicks || 0)
    })),
    sources: sourceResult.rows.map((row) => ({
      source: row.source,
      profile_views: Number(row.profile_views || 0),
      contact_clicks: Number(row.contact_clicks || 0)
    }))
  };
}

async function getAdminAnalyticsOverview(input = {}) {
  const { days, profileId, ownerUserId } = normalizeAdminAnalyticsInput(input);
  await ensureProfileAnalyticsStorage();

  let selectedProfile = null;
  if (profileId) {
    const profileResult = await query(
      `select id, name, slug, owner_user_id, is_active
       from public.profiles
       where id = $1::bigint
       limit 1`,
      [profileId]
    );
    selectedProfile = profileResult.rows[0] || null;
    if (!selectedProfile) {
      throw analyticsError("Analiz profili bulunamadı.", 404, "ANALYTICS_PROFILE_NOT_FOUND");
    }
  }

  const filterParams = [days, profileId, ownerUserId];
  const [summaryResult, dailyResult, topProfilesResult, sourceResult] = await Promise.all([
    query(
      `
        with boundary as (
          select
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1)) as start_date,
            (now() at time zone '${TIMEZONE}')::date as end_date
        )
        select
          boundary.start_date::text,
          boundary.end_date::text,
          (
            select min(marker.created_at)
            from public.analytics_events marker
            where marker.event_type in ('profile_view', 'contact_click')
              and coalesce(marker.bot, false) = false
              and ($2::bigint is null or marker.profile_id = $2::bigint)
              and ($3::text is null or marker.owner_user_id_snapshot = $3::text)
              and exists (
                select 1
                from public.profiles marker_profile
                where marker_profile.id::bigint = marker.profile_id
                  and ($3::text is null or marker_profile.owner_user_id = $3::text)
              )
          ) as tracking_started_at,
          count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
          count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'whatsapp'
          )::bigint as whatsapp_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'phone'
          )::bigint as phone_clicks,
          count(*) filter (
            where events.event_type = 'contact_click' and events.action = 'telegram'
          )::bigint as telegram_clicks
        from boundary
        left join public.analytics_events events
          on events.created_at >=
            (boundary.start_date::timestamp at time zone '${TIMEZONE}')
          and events.created_at <
            ((boundary.end_date + 1)::timestamp at time zone '${TIMEZONE}')
          and events.event_type in ('profile_view', 'contact_click')
          and coalesce(events.bot, false) = false
          and ($2::bigint is null or events.profile_id = $2::bigint)
          and ($3::text is null or events.owner_user_id_snapshot = $3::text)
          and exists (
            select 1
            from public.profiles profiles
            where profiles.id::bigint = events.profile_id
              and ($3::text is null or profiles.owner_user_id = $3::text)
          )
        group by boundary.start_date, boundary.end_date
      `,
      filterParams
    ),
    query(
      `
        with days as (
          select generate_series(
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp,
            (now() at time zone '${TIMEZONE}')::date::timestamp,
            interval '1 day'
          )::date as report_date
        ),
        scoped as (
          select
            (events.created_at at time zone '${TIMEZONE}')::date as report_date,
            count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
            count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks
          from public.analytics_events events
          join public.profiles profiles
            on profiles.id::bigint = events.profile_id
          where events.created_at >= (
              ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp
              at time zone '${TIMEZONE}'
            )
            and events.created_at < (
              ((now() at time zone '${TIMEZONE}')::date + 1)::timestamp
              at time zone '${TIMEZONE}'
            )
            and events.event_type in ('profile_view', 'contact_click')
            and coalesce(events.bot, false) = false
            and ($2::bigint is null or events.profile_id = $2::bigint)
            and ($3::text is null or profiles.owner_user_id = $3::text)
            and ($3::text is null or events.owner_user_id_snapshot = $3::text)
          group by (events.created_at at time zone '${TIMEZONE}')::date
        )
        select
          days.report_date::text as date,
          coalesce(scoped.profile_views, 0)::bigint as profile_views,
          coalesce(scoped.contact_clicks, 0)::bigint as contact_clicks
        from days
        left join scoped using (report_date)
        order by days.report_date
      `,
      filterParams
    ),
    query(
      `
        select
          profiles.id,
          profiles.name,
          profiles.slug,
          profiles.owner_user_id,
          profiles.is_active,
          count(*) filter (where events.event_type = 'profile_view')::bigint as profile_views,
          count(*) filter (where events.event_type = 'contact_click')::bigint as contact_clicks
        from public.analytics_events events
        join public.profiles profiles on profiles.id::bigint = events.profile_id
        where events.created_at >= (
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.created_at < (
            ((now() at time zone '${TIMEZONE}')::date + 1)::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.event_type in ('profile_view', 'contact_click')
          and coalesce(events.bot, false) = false
          and ($2::bigint is null or events.profile_id = $2::bigint)
          and ($3::text is null or profiles.owner_user_id = $3::text)
          and ($3::text is null or events.owner_user_id_snapshot = $3::text)
        group by
          profiles.id,
          profiles.name,
          profiles.slug,
          profiles.owner_user_id,
          profiles.is_active
        order by
          count(*) filter (where events.event_type = 'profile_view') desc,
          count(*) filter (where events.event_type = 'contact_click') desc,
          profiles.id
        limit 25
      `,
      filterParams
    ),
    query(
      `
        select
          coalesce(nullif(events.source, ''), 'unknown') as source,
          count(*)::bigint as event_count
        from public.analytics_events events
        join public.profiles profiles
          on profiles.id::bigint = events.profile_id
        where events.created_at >= (
            ((now() at time zone '${TIMEZONE}')::date - ($1::int - 1))::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.created_at < (
            ((now() at time zone '${TIMEZONE}')::date + 1)::timestamp
            at time zone '${TIMEZONE}'
          )
          and events.event_type = 'profile_view'
          and coalesce(events.bot, false) = false
          and ($2::bigint is null or events.profile_id = $2::bigint)
          and ($3::text is null or profiles.owner_user_id = $3::text)
          and ($3::text is null or events.owner_user_id_snapshot = $3::text)
        group by coalesce(nullif(events.source, ''), 'unknown')
        order by count(*) desc, source
      `,
      filterParams
    )
  ]);

  const summary = summaryResult.rows[0] || {};
  const profileViews = Number(summary.profile_views || 0);
  const contactClicks = Number(summary.contact_clicks || 0);
  const trackingStartedAt = summary.tracking_started_at
    ? new Date(summary.tracking_started_at).toISOString()
    : "";
  const startBoundary = summary.start_date
    ? new Date(`${summary.start_date}T00:00:00+03:00`)
    : null;
  const coverageComplete = Boolean(
    trackingStartedAt &&
    startBoundary &&
    new Date(trackingStartedAt) <= startBoundary
  );

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    timezone: TIMEZONE,
    period: {
      days,
      start_date: summary.start_date || "",
      end_date: summary.end_date || ""
    },
    coverage: {
      status: trackingStartedAt
        ? coverageComplete ? "complete" : "partial"
        : "not_started",
      complete: coverageComplete,
      tracking_started_at: trackingStartedAt
    },
    selected_profile: selectedProfile,
    totals: {
      profile_views: profileViews,
      contact_clicks: contactClicks,
      action_rate: profileViews
        ? Number(((contactClicks / profileViews) * 100).toFixed(2))
        : 0
    },
    channels: {
      whatsapp: Number(summary.whatsapp_clicks || 0),
      phone: Number(summary.phone_clicks || 0),
      telegram: Number(summary.telegram_clicks || 0)
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      profile_views: Number(row.profile_views || 0),
      contact_clicks: Number(row.contact_clicks || 0)
    })),
    sources: sourceResult.rows.map((row) => ({
      source: row.source,
      profile_views: Number(row.event_count || 0)
    })),
    top_profiles: topProfilesResult.rows.map((row) => {
      const views = Number(row.profile_views || 0);
      const clicks = Number(row.contact_clicks || 0);
      return {
        id: row.id,
        name: row.name || "",
        slug: row.slug || "",
        owner_user_id: row.owner_user_id || "",
        is_active: row.is_active === true,
        profile_views: views,
        contact_clicks: clicks,
        action_rate: views ? Number(((clicks / views) * 100).toFixed(2)) : 0
      };
    })
  };
}

module.exports = {
  CONTACT_CHANNELS,
  EVENT_TYPES,
  SOURCES,
  assertCustomerAnalyticsScope,
  ensureProfileAnalyticsStorage,
  getAdminAnalyticsOverview,
  getCustomerDailyAnalytics,
  getCustomerProfileAnalytics,
  normalizeCustomerAnalyticsInput,
  normalizeEvent,
  recordProfileAnalyticsEvent
};
