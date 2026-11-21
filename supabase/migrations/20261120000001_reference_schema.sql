-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0001 reference & market data
--
-- Conventions
--   * Odds are decimal, numeric(12,4). Money is numeric(16,2). Probabilities numeric(9,6).
--   * Catalog tables (sports, leagues, market_types, bookmakers, events) hold both
--     platform rows (owner_id IS NULL, readable by every signed-in user, written only by
--     the service role) and user-defined rows (owner_id = the user, private to them).
--   * Every user-owned row that can be demo data carries is_demo. Demo rows are only ever
--     shown while the user's workspace mode is 'demo' and are deleted by reset_demo_data().
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type bet_status as enum ('pending','won','lost','void','half_won','half_lost','cashed_out');
create type leg_status as enum ('pending','won','lost','void','half_won','half_lost');
create type bet_side   as enum ('back','lay');
create type bet_kind   as enum ('single','accumulator');
create type tx_type    as enum (
  'deposit','withdrawal','bet_placement','bet_settlement','cashout','bet_reversal',
  'transfer_in','transfer_out','adjustment','trade_settlement'
);
create type trade_status    as enum ('open','settled','void');
create type execution_side  as enum ('back','lay','cashout');
create type trade_outcome   as enum ('win','lose','void');
create type alert_severity  as enum ('info','warning','critical');
create type event_status    as enum ('scheduled','live','finished','postponed','cancelled','suspended','unknown');
create type workspace_mode  as enum ('live','demo');
create type clv_convention  as enum ('odds','probability');
create type app_role        as enum ('user','admin');

-- ── Profiles & settings ──────────────────────────────────────────────────────
-- auth.users is the identity table ("users"); profiles extends it 1:1.
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text check (char_length(display_name) <= 80),
  role          app_role not null default 'user',
  base_currency char(3) not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table user_settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  mode                    workspace_mode not null default 'live',
  odds_format             text not null default 'decimal' check (odds_format in ('decimal','american','fractional')),
  display_currency        char(3) not null default 'EUR' check (display_currency ~ '^[A-Z]{3}$'),
  timezone                text not null default 'UTC',
  theme                   text not null default 'dark' check (theme in ('dark','darker','light')),
  clv_convention          clv_convention not null default 'odds',
  clv_reference_bookmaker uuid,                          -- FK added below (bookmakers defined later)
  default_kelly_fraction  numeric(5,4) not null default 0.25 check (default_kelly_fraction > 0 and default_kelly_fraction <= 1),
  unit_size               numeric(16,2) not null default 10 check (unit_size > 0),
  default_bankroll_id     uuid,
  dashboard_widgets       jsonb not null default '[]'::jsonb,
  alert_preferences       jsonb not null default '{"large_result": 250, "odds_move_pct": 0.08, "email": false}'::jsonb,
  updated_at              timestamptz not null default now()
);

-- ── Sports, leagues, configurable markets ────────────────────────────────────
create table sports (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users(id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name       text not null check (char_length(name) between 1 and 60),
  sort_order int  not null default 100,
  has_draw   boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index sports_key_uq on sports (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table leagues (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users(id) on delete cascade,
  sport_id   uuid not null references sports(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  country    text,
  provider_keys jsonb not null default '{}'::jsonb,       -- e.g. {"the_odds_api":"soccer_epl"}
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index leagues_name_uq on leagues (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), sport_id, lower(name));
create index leagues_sport_idx on leagues (sport_id);

-- Market catalogue. Not hardcoded in the app: users can add their own.
--   settlement: how results are recorded ('binary' won/lost/void, 'quarter' allows half results
--   for Asian lines, 'multi' for 3-way & correct score).
create table market_types (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete cascade,
  sport_id    uuid references sports(id) on delete cascade,   -- null = available for all sports
  key         text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  name        text not null check (char_length(name) between 1 and 80),
  category    text not null check (category in ('result','handicap','totals','props','specials','other')),
  has_line    boolean not null default false,
  outcomes    text[] not null default '{}',                  -- template outcomes, e.g. {Home,Draw,Away}
  settlement  text not null default 'binary' check (settlement in ('binary','quarter','multi')),
  provider_keys jsonb not null default '{}'::jsonb,         -- e.g. {"the_odds_api":"h2h"}
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index market_types_key_uq on market_types (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(sport_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table bookmakers (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid references auth.users(id) on delete cascade,
  key                text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  name               text not null check (char_length(name) between 1 and 80),
  is_exchange        boolean not null default false,
  default_commission numeric(6,5) not null default 0 check (default_commission >= 0 and default_commission < 1),
  website            text,
  provider_keys      jsonb not null default '{}'::jsonb,   -- e.g. {"the_odds_api":"pinnacle"}
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create unique index bookmakers_key_uq on bookmakers (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

alter table user_settings
  add constraint user_settings_clv_ref_fk foreign key (clv_reference_bookmaker) references bookmakers(id) on delete set null;

-- Per-user account details at a bookmaker (limits, account currency, notes).
create table bookmaker_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  bookmaker_id  uuid not null references bookmakers(id) on delete cascade,
  currency      char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  commission    numeric(6,5) check (commission >= 0 and commission < 1),
  max_stake     numeric(16,2) check (max_stake > 0),
  status        text not null default 'active' check (status in ('active','limited','restricted','closed')),
  notes         text check (char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  unique (user_id, bookmaker_id)
);

-- ── Events & event markets ───────────────────────────────────────────────────
create table events (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users(id) on delete cascade,  -- null = platform-ingested
  is_demo      boolean not null default false,
  sport_id     uuid not null references sports(id),
  league_id    uuid references leagues(id),
  name         text not null check (char_length(name) between 1 and 200),
  home         text,
  away         text,
  start_time   timestamptz not null,
  status       event_status not null default 'scheduled',
  score        jsonb,
  provider     text,                                  -- 'the_odds_api' | 'api_football' | 'manual' | 'demo'
  external_id  text,
  last_synced_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index events_external_uq on events (provider, external_id, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) where external_id is not null;
create index events_start_idx on events (start_time);
create index events_sport_idx on events (sport_id, start_time);

create table markets (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  market_type_id uuid references market_types(id),
  key            text not null,                       -- normalised key, e.g. 'h2h', 'totals'
  name           text not null,
  line           numeric(8,2),
  status         text not null default 'open' check (status in ('open','suspended','closed','settled')),
  created_at     timestamptz not null default now()
);
create unique index markets_uq on markets (event_id, key, coalesce(line, -99999));

-- ── Exchange rates (historical snapshots) ────────────────────────────────────
create table exchange_rates (
  id         bigint generated always as identity primary key,
  owner_id   uuid references auth.users(id) on delete cascade,  -- null = platform feed
  base       char(3) not null check (base ~ '^[A-Z]{3}$'),
  quote      char(3) not null check (quote ~ '^[A-Z]{3}$'),
  rate       numeric(18,8) not null check (rate > 0),          -- 1 base = rate quote
  as_of      date not null,
  source     text not null default 'manual',
  created_at timestamptz not null default now(),
  check (base <> quote)
);
create unique index exchange_rates_uq on exchange_rates (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), base, quote, as_of);
create index exchange_rates_lookup on exchange_rates (base, quote, as_of desc);

-- ── Odds providers, connections, logs ────────────────────────────────────────
create table odds_providers (
  id                    text primary key,                       -- 'the_odds_api'
  name                  text not null,
  kind                  text not null check (kind in ('odds','sports_data','odds_and_data')),
  base_url              text not null,
  docs_url              text,
  auth_scheme           text not null,                          -- 'query:apiKey' | 'header:x-apisports-key'
  default_rate_limit_per_minute int not null default 30,
  min_refresh_seconds   int not null default 60,
  supports_live         boolean not null default false,
  supports_history      boolean not null default false,
  implemented           boolean not null default false,         -- adapter exists in this codebase
  notes                 text
);

create table api_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider_id        text not null references odds_providers(id),
  label              text not null default 'default',
  key_last4          text,                                       -- display only
  config             jsonb not null default '{}'::jsonb,         -- regions, markets, sports, refresh_seconds
  is_enabled         boolean not null default true,
  status             text not null default 'untested' check (status in ('untested','ok','error','rate_limited')),
  last_tested_at     timestamptz,
  last_success_at    timestamptz,
  last_error         text,
  quota_used         int,
  quota_remaining    int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, provider_id, label)
);

-- Encrypted API keys. RLS enabled with NO policies: only the service role (server) can read.
create table api_connection_secrets (
  connection_id  uuid primary key references api_connections(id) on delete cascade,
  ciphertext     text not null,          -- AES-256-GCM, base64(iv|tag|data), key in API_KEY_ENCRYPTION_KEY
  updated_at     timestamptz not null default now()
);

create table api_request_logs (
  id             bigint generated always as identity primary key,
  user_id        uuid references auth.users(id) on delete cascade,
  connection_id  uuid references api_connections(id) on delete set null,
  provider_id    text not null,
  endpoint       text not null,          -- path only, secrets redacted
  status         int,
  duration_ms    int,
  cache_hit      boolean not null default false,
  cost_units     int,
  quota_remaining int,
  error          text,
  at             timestamptz not null default now()
);
create index api_request_logs_user_idx on api_request_logs (user_id, at desc);

-- ── Historical odds ──────────────────────────────────────────────────────────
-- Append-only price history. owner_id/is_demo are denormalised from the event for fast RLS.
create table odds_snapshots (
  id           bigint generated always as identity primary key,
  owner_id     uuid references auth.users(id) on delete cascade,
  is_demo      boolean not null default false,
  event_id     uuid not null references events(id) on delete cascade,
  market_id    uuid not null references markets(id) on delete cascade,
  bookmaker_id uuid not null references bookmakers(id),
  selection    text not null,
  line         numeric(8,2),
  odds         numeric(12,4) not null check (odds > 1),
  is_live      boolean not null default false,
  is_closing   boolean not null default false,
  suspended    boolean not null default false,
  provider     text not null,
  provider_updated_at timestamptz,
  captured_at  timestamptz not null default now()
);
create index odds_snapshots_market_idx on odds_snapshots (market_id, bookmaker_id, selection, captured_at desc);
create index odds_snapshots_event_idx on odds_snapshots (event_id, captured_at desc);
create index odds_snapshots_closing_idx on odds_snapshots (market_id, selection) where is_closing;

-- Latest and opening price per (market, bookmaker, selection).
create view odds_latest with (security_invoker = true) as
  select distinct on (market_id, bookmaker_id, selection) *
  from odds_snapshots
  order by market_id, bookmaker_id, selection, captured_at desc;

create view odds_opening with (security_invoker = true) as
  select distinct on (market_id, bookmaker_id, selection) *
  from odds_snapshots
  order by market_id, bookmaker_id, selection, captured_at asc;
