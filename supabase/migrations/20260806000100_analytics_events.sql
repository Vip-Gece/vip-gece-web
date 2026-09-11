create table if not exists public.analytics_events (
  id bigint primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  profile_id bigint,
  owner_user_id_snapshot text,
  page_url text,
  referrer text,
  user_agent text,
  event_id text,
  visitor_id text,
  session_id text,
  path text,
  title text,
  referrer_host text,
  source text,
  medium text,
  search_query text,
  utm_campaign text,
  utm_content text,
  profile_slug text,
  profile_name text,
  district_slug text,
  target_url text,
  action text,
  duration_ms integer,
  scroll_depth integer,
  viewport_width integer,
  viewport_height integer,
  screen_width integer,
  screen_height integer,
  device_type text,
  language text,
  timezone text,
  country text,
  ip_hash text,
  bot boolean default false
);

alter table public.analytics_events
  add column if not exists owner_user_id_snapshot text;

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_type_idx
  on public.analytics_events (event_type);

create index if not exists analytics_profile_id_idx
  on public.analytics_events (profile_id);

create index if not exists analytics_events_owner_profile_created_idx
  on public.analytics_events (owner_user_id_snapshot, profile_id, created_at desc)
  where coalesce(bot, false) = false
    and event_type in ('profile_view', 'contact_click');

create unique index if not exists analytics_events_event_id_uidx
  on public.analytics_events (event_id)
  where event_id is not null;

create index if not exists analytics_events_profile_slug_idx
  on public.analytics_events (profile_slug);

create index if not exists analytics_events_session_id_idx
  on public.analytics_events (session_id);

create index if not exists analytics_events_search_query_idx
  on public.analytics_events (search_query)
  where search_query is not null and search_query <> '';

-- Analytics is written and read only by the trusted server database connection.
-- Keep the public-schema table unreachable through browser-facing Data API roles.
alter table public.analytics_events
  enable row level security;

revoke all on table public.analytics_events from public;
revoke all on table public.analytics_events from anon;
revoke all on table public.analytics_events from authenticated;
