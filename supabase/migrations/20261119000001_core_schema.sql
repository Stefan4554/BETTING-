-- EDGE INTELLIGENCE — core schema
-- Normalized PostgreSQL schema for Supabase. All timestamps are timestamptz (UTC).
-- Every row that originates from an external provider carries provider + provider_ref
-- so data can be traced back to its source and is never mixed with demo data.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app_role as enum ('user', 'analyst', 'admin');
create type sport_code as enum ('tennis', 'football', 'basketball', 'ice_hockey');
create type surface_type as enum ('hard', 'clay', 'grass', 'indoor_hard', 'carpet', 'unknown');
create type tour_type as enum ('atp', 'wta', 'challenger', 'itf_men', 'itf_women', 'grand_slam', 'other');
create type match_status as enum ('scheduled', 'live', 'suspended', 'interrupted', 'delayed', 'completed', 'retired', 'walkover', 'cancelled', 'postponed', 'unknown');
create type market_type as enum ('match_winner', 'set_winner', 'game_handicap', 'set_handicap', 'total_games', 'total_sets', 'correct_score', 'player_prop');
create type bet_status as enum ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost', 'cashed_out');
create type bankroll_tx_type as enum ('deposit', 'withdrawal', 'bet_stake', 'bet_return', 'adjustment');
create type provider_kind as enum ('odds', 'sports_data');
create type notification_channel as enum ('in_app', 'email');
create type alert_type as enum ('odds_move_pct', 'best_odds_available', 'value_edge_threshold', 'market_change', 'match_start', 'match_status_change', 'model_probability_change');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Users (profile + role; identity lives in auth.users)
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext unique,
  display_name text,
  role app_role not null default 'user',
  base_currency char(3) not null default 'EUR',
  kelly_fraction numeric(4,3) not null default 0.25 check (kelly_fraction > 0 and kelly_fraction <= 1),
  max_stake_pct numeric(5,4) not null default 0.02 check (max_stake_pct > 0 and max_stake_pct <= 1),
  min_edge_pct numeric(6,4) not null default 0.02,
  model_confidence numeric(4,3) not null default 1.0 check (model_confidence >= 0 and model_confidence <= 1),
  odds_format text not null default 'decimal' check (odds_format in ('decimal', 'american', 'fractional')),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_users_updated before update on users for each row execute function set_updated_at();

-- Auto-create a profile row when someone signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- API providers + logs (declared early: referenced by data tables)
-- ---------------------------------------------------------------------------
create table api_providers (
  id text primary key,                         -- 'the_odds_api', 'sportradar_tennis', ...
  name text not null,
  kind provider_kind not null,
  base_url text not null,
  enabled boolean not null default false,
  -- Keys are NEVER stored in plain text here. Production keys live in env vars
  -- (Vercel encrypted env) or Supabase Vault; this column holds a vault secret id.
  vault_secret_id uuid,
  rate_limit_per_minute integer,
  monthly_quota integer,
  quota_used integer,
  quota_remaining integer,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_api_providers_updated before update on api_providers for each row execute function set_updated_at();

create table api_logs (
  id bigint generated always as identity primary key,
  provider_id text not null references api_providers (id) on delete cascade,
  endpoint text not null,                     -- path only; query strings are stripped of keys
  method text not null default 'GET',
  status_code integer,
  duration_ms integer,
  cost_units integer,                         -- e.g. The Odds API x-requests-last
  cache_hit boolean not null default false,
  error text,
  requested_at timestamptz not null default now()
);
create index api_logs_provider_time_idx on api_logs (provider_id, requested_at desc);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table players (
  id uuid primary key default gen_random_uuid(),
  sport sport_code not null default 'tennis',
  full_name text not null,
  short_name text,
  country_code char(3),
  birth_date date,
  handedness text check (handedness in ('right', 'left', 'unknown')),
  backhand text check (backhand in ('one_handed', 'two_handed', 'unknown')),
  height_cm smallint check (height_cm between 120 and 240),
  tour tour_type,
  provider text not null,
  provider_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index players_name_idx on players using gin (to_tsvector('simple', full_name));
create trigger trg_players_updated before update on players for each row execute function set_updated_at();

create table player_rankings (
  id bigint generated always as identity primary key,
  player_id uuid not null references players (id) on delete cascade,
  tour tour_type not null,
  ranking_type text not null default 'singles',
  rank integer not null check (rank > 0),
  points integer,
  movement integer,
  ranking_date date not null,
  provider text not null,
  created_at timestamptz not null default now(),
  unique (player_id, tour, ranking_type, ranking_date)
);
create index player_rankings_date_idx on player_rankings (tour, ranking_date desc, rank);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  sport sport_code not null default 'tennis',
  name text not null,
  tour tour_type not null,
  level text,                                 -- 'grand_slam','masters_1000','500','250','challenger_125', ...
  surface surface_type not null default 'unknown',
  indoor boolean,
  country_code char(3),
  city text,
  start_date date,
  end_date date,
  best_of smallint check (best_of in (3, 5)),
  provider text not null,
  provider_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index tournaments_dates_idx on tournaments (start_date, end_date);
create trigger trg_tournaments_updated before update on tournaments for each row execute function set_updated_at();

create table matches (
  id uuid primary key default gen_random_uuid(),
  sport sport_code not null default 'tennis',
  tournament_id uuid references tournaments (id) on delete set null,
  round text,
  player_a_id uuid not null references players (id),
  player_b_id uuid not null references players (id),
  scheduled_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  status match_status not null default 'scheduled',
  best_of smallint check (best_of in (3, 5)),
  surface surface_type not null default 'unknown',
  winner_id uuid references players (id),
  score jsonb,                                 -- normalized {sets:[{a,b,tb_a,tb_b}], game:{a,b}, server}
  provider text not null,
  provider_ref text not null,
  data_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref),
  check (player_a_id <> player_b_id)
);
create index matches_schedule_idx on matches (scheduled_at);
create index matches_status_idx on matches (status) where status in ('live', 'suspended', 'interrupted', 'delayed');
create index matches_player_a_idx on matches (player_a_id, scheduled_at desc);
create index matches_player_b_idx on matches (player_b_id, scheduled_at desc);
create trigger trg_matches_updated before update on matches for each row execute function set_updated_at();

-- Cross-provider identity mapping (Odds API events have no player ids, only names).
create table provider_entity_map (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('player', 'tournament', 'match')),
  entity_id uuid not null,
  provider text not null,
  provider_ref text not null,
  confidence numeric(4,3) not null default 1.0,
  created_at timestamptz not null default now(),
  unique (entity_type, provider, provider_ref)
);

-- Per-player per-match statistics. NULL means "not provided" — never 0 by default.
create table match_statistics (
  id bigint generated always as identity primary key,
  match_id uuid not null references matches (id) on delete cascade,
  player_id uuid not null references players (id),
  period text not null default 'match',       -- 'match','set_1','set_2', ...
  aces smallint,
  double_faults smallint,
  first_serve_in smallint,
  first_serve_attempts smallint,
  first_serve_points_won smallint,
  first_serve_points_played smallint,
  second_serve_points_won smallint,
  second_serve_points_played smallint,
  break_points_saved smallint,
  break_points_faced smallint,
  break_points_converted smallint,
  break_points_opportunities smallint,
  service_games_won smallint,
  service_games_played smallint,
  return_games_won smallint,
  return_games_played smallint,
  total_points_won smallint,
  winners smallint,
  unforced_errors smallint,
  provider text not null,
  data_updated_at timestamptz not null default now(),
  unique (match_id, player_id, period)
);

create table head_to_head (
  id bigint generated always as identity primary key,
  player_low_id uuid not null references players (id),   -- canonical ordering: low uuid first
  player_high_id uuid not null references players (id),
  wins_low integer not null default 0,
  wins_high integer not null default 0,
  surface surface_type,                                   -- NULL = all surfaces
  last_match_id uuid references matches (id),
  updated_at timestamptz not null default now(),
  check (player_low_id < player_high_id),
  unique nulls not distinct (player_low_id, player_high_id, surface)
);

-- ---------------------------------------------------------------------------
-- Markets & odds
-- ---------------------------------------------------------------------------
create table bookmakers (
  id text primary key,                         -- provider key e.g. 'pinnacle', 'betfair_ex_eu'
  name text not null,
  region text,
  is_exchange boolean not null default false,
  is_sharp boolean not null default false,     -- used for market-consensus weighting
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table betting_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches (id) on delete cascade,
  market market_type not null,
  line numeric(6,2),                           -- handicap / total line; NULL for match winner
  period text not null default 'match',
  created_at timestamptz not null default now(),
  unique nulls not distinct (match_id, market, line, period)
);

-- Append-only time series of every price we have observed.
create table odds_snapshots (
  id bigint generated always as identity primary key,
  market_id uuid not null references betting_markets (id) on delete cascade,
  bookmaker_id text not null references bookmakers (id),
  selection text not null,                     -- 'player_a','player_b','over','under', score string
  price numeric(8,3) not null check (price > 1.0),
  is_live boolean not null default false,
  is_closing boolean not null default false,
  bookmaker_updated_at timestamptz,            -- the bookmaker's own last_update
  captured_at timestamptz not null default now(),
  provider text not null
);
create index odds_snapshots_market_time_idx on odds_snapshots (market_id, captured_at desc);
create index odds_snapshots_book_idx on odds_snapshots (bookmaker_id, captured_at desc);
create index odds_snapshots_closing_idx on odds_snapshots (market_id) where is_closing;

-- Latest price per (market, bookmaker, selection) for fast board queries.
create view odds_latest as
select distinct on (market_id, bookmaker_id, selection)
  id, market_id, bookmaker_id, selection, price, is_live, bookmaker_updated_at, captured_at, provider
from odds_snapshots
order by market_id, bookmaker_id, selection, captured_at desc;

create view odds_opening as
select distinct on (market_id, bookmaker_id, selection)
  market_id, bookmaker_id, selection, price, captured_at
from odds_snapshots
order by market_id, bookmaker_id, selection, captured_at asc;

-- ---------------------------------------------------------------------------
-- Models
-- ---------------------------------------------------------------------------
create table model_versions (
  id text primary key,                         -- e.g. 'elo-surface-v1'
  description text,
  params jsonb not null default '{}'::jsonb,
  train_end_date date,                         -- chronological cut-off, no data after this used in training
  brier_score numeric(8,6),
  log_loss numeric(8,6),
  accuracy numeric(6,5),
  sample_size integer,
  calibration jsonb,
  created_at timestamptz not null default now()
);

create table predictions (
  id bigint generated always as identity primary key,
  match_id uuid not null references matches (id) on delete cascade,
  model_version_id text not null references model_versions (id),
  prob_player_a numeric(6,5) not null check (prob_player_a between 0 and 1),
  ci_low numeric(6,5),
  ci_high numeric(6,5),
  is_live boolean not null default false,
  sample_size_a integer,                       -- matches of history behind each rating
  sample_size_b integer,
  data_quality numeric(4,3) check (data_quality between 0 and 1),
  features jsonb,
  created_at timestamptz not null default now()
);
create index predictions_match_idx on predictions (match_id, created_at desc);

create table value_opportunities (
  id bigint generated always as identity primary key,
  match_id uuid not null references matches (id) on delete cascade,
  market_id uuid not null references betting_markets (id) on delete cascade,
  prediction_id bigint references predictions (id) on delete set null,
  selection text not null,
  bookmaker_id text not null references bookmakers (id),
  best_odds numeric(8,3) not null,
  fair_odds numeric(8,3) not null,
  model_probability numeric(6,5) not null,
  market_probability numeric(6,5),             -- no-vig consensus
  edge_pct numeric(8,5) not null,
  expected_value numeric(8,5) not null,
  kelly_fraction numeric(8,5),
  confidence text check (confidence in ('low', 'medium', 'high')),
  data_quality numeric(4,3),
  odds_captured_at timestamptz not null,
  detected_at timestamptz not null default now(),
  expired_at timestamptz
);
create index value_opps_active_idx on value_opportunities (detected_at desc) where expired_at is null;

-- ---------------------------------------------------------------------------
-- Betting tracker & bankroll (user-owned)
-- ---------------------------------------------------------------------------
create table bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  match_id uuid references matches (id) on delete set null,
  sport sport_code not null default 'tennis',
  event_label text not null,                   -- free text so manual bets work without a match row
  market market_type not null default 'match_winner',
  selection text not null,
  bookmaker_id text references bookmakers (id),
  bookmaker_label text,
  odds numeric(8,3) not null check (odds > 1.0),
  stake numeric(12,2) not null check (stake > 0),
  closing_odds numeric(8,3) check (closing_odds > 1.0),
  status bet_status not null default 'pending',
  profit numeric(12,2),                        -- computed by trigger
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bets_user_time_idx on bets (user_id, placed_at desc);
create trigger trg_bets_updated before update on bets for each row execute function set_updated_at();

create or replace function compute_bet_profit() returns trigger
language plpgsql as $$
begin
  new.profit := case new.status
    when 'won'        then round(new.stake * (new.odds - 1), 2)
    when 'lost'       then -new.stake
    when 'void'       then 0
    when 'half_won'   then round(new.stake / 2 * (new.odds - 1), 2)
    when 'half_lost'  then round(-new.stake / 2, 2)
    else new.profit                              -- pending: NULL; cashed_out: user-entered
  end;
  if new.status = 'pending' then new.profit := null; end if;
  if new.status <> 'pending' and new.settled_at is null then new.settled_at := now(); end if;
  return new;
end $$;
create trigger trg_bets_profit before insert or update on bets for each row execute function compute_bet_profit();

create table bankroll_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  bet_id uuid references bets (id) on delete set null,
  type bankroll_tx_type not null,
  amount numeric(12,2) not null,               -- signed
  note text,
  occurred_at timestamptz not null default now()
);
create index bankroll_tx_user_idx on bankroll_transactions (user_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Alerts & notifications
-- ---------------------------------------------------------------------------
create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  type alert_type not null,
  threshold numeric(10,4),
  match_id uuid references matches (id) on delete cascade,
  player_id uuid references players (id) on delete cascade,
  channels notification_channel[] not null default '{in_app}',
  active boolean not null default true,
  cooldown_minutes integer not null default 30,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index alert_rules_active_idx on alert_rules (type) where active;

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  alert_rule_id uuid references alert_rules (id) on delete set null,
  title text not null,
  body text,
  payload jsonb,
  channel notification_channel not null default 'in_app',
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on notifications (user_id, created_at desc) where read_at is null;

-- Realtime: odds, matches and the user's notifications stream to the client.
alter publication supabase_realtime add table odds_snapshots, matches, notifications;
