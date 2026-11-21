-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0002 bankrolls, ledger, bets, trades, strategies, risk, alerts
--
-- Accounting model (see docs/FINANCIAL_MODEL.md):
--   * bankroll_transactions is an append-only ledger. A bankroll's balance is the sum of
--     its transactions; bankrolls.balance is a cache maintained by trigger.
--   * Placing a bet RESERVES its stake (back) or liability (lay): a negative bet_placement.
--   * Settling a bet credits the payout (reservation + profit): a positive bet_settlement.
--   * Deposits, withdrawals, transfers and adjustments are capital flows and never
--     contribute to betting profit, which is always computed from bets.profit / trades.
--   * Rows with financial effect are written only through SECURITY DEFINER functions in
--     0003; clients have SELECT-only access to them (see 0004 RLS).
-- ════════════════════════════════════════════════════════════════════════════

create table bankrolls (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  is_demo       boolean not null default false,
  name          text not null check (char_length(name) between 1 and 60),
  kind          text not null default 'custom' check (kind in ('main','sport','live','custom')),
  sport_id      uuid references sports(id) on delete set null,
  currency      char(3) not null check (currency ~ '^[A-Z]{3}$'),
  balance       numeric(16,2) not null default 0,     -- cache of sum(transactions.amount)
  allow_negative boolean not null default false,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (user_id, is_demo, name)
);
create index bankrolls_user_idx on bankrolls (user_id, is_demo);

create table strategies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  is_demo         boolean not null default false,
  name            text not null check (char_length(name) between 1 and 80),
  description     text check (char_length(description) <= 4000),
  sport_id        uuid references sports(id) on delete set null,
  market_type_id  uuid references market_types(id) on delete set null,
  entry_conditions text check (char_length(entry_conditions) <= 4000),
  min_odds        numeric(12,4) check (min_odds > 1),
  max_odds        numeric(12,4) check (max_odds > 1),
  est_probability numeric(9,6) check (est_probability > 0 and est_probability < 1),
  stake_rule      jsonb not null default '{"type":"flat","value":1}'::jsonb,
  color           text not null default '#3b82f6',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  check (min_odds is null or max_odds is null or min_odds <= max_odds),
  unique (user_id, is_demo, name)
);

create table bets (
  id               uuid primary key default gen_random_uuid(),
  ref              bigint generated always as identity,          -- human-readable bet number
  user_id          uuid not null references auth.users(id) on delete cascade,
  is_demo          boolean not null default false,
  bankroll_id      uuid not null references bankrolls(id),
  client_ref       uuid,                                          -- idempotency key from the client
  kind             bet_kind not null default 'single',
  side             bet_side not null default 'back',
  placed_at        timestamptz not null default now(),
  -- identification
  sport_id         uuid not null references sports(id),
  league_id        uuid references leagues(id) on delete set null,
  event_id         uuid references events(id) on delete set null,
  market_id        uuid references markets(id) on delete set null,
  event_name       text not null check (char_length(event_name) between 1 and 300),
  home             text,
  away             text,
  event_start      timestamptz,
  is_live          boolean not null default false,
  market_type_id   uuid references market_types(id) on delete set null,
  market_category  text,
  market           text not null check (char_length(market) between 1 and 120),
  selection        text not null check (char_length(selection) between 1 and 200),
  line             numeric(8,2),
  -- financial (in bet currency)
  bookmaker_id     uuid references bookmakers(id) on delete set null,
  odds             numeric(12,4) not null check (odds > 1),
  stake            numeric(16,2) not null check (stake > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate          numeric(18,8) not null default 1 check (fx_rate > 0),  -- bet ccy → bankroll ccy, locked at placement
  commission       numeric(6,5) not null default 0 check (commission >= 0 and commission < 1),
  liability        numeric(16,2) not null,                    -- reserved amount: stake (back) or stake×(odds−1) (lay)
  potential_payout numeric(16,2) not null,                    -- gross return if the bet wins in full
  cashed_out_stake numeric(16,2) not null default 0 check (cashed_out_stake >= 0),
  cashout_amount   numeric(16,2) not null default 0 check (cashout_amount >= 0),
  settled_cashout_stake  numeric(16,2) not null default 0,   -- portion closed by a full cash-out at settlement
  settled_cashout_amount numeric(16,2) not null default 0,   -- amount of that final cash-out
  actual_payout    numeric(16,2),
  profit           numeric(16,2),                             -- null while pending
  status           bet_status not null default 'pending',
  settled_at       timestamptz,
  settle_count     int not null default 0,
  -- analytics
  est_probability  numeric(9,6) check (est_probability > 0 and est_probability < 1),
  opening_odds     numeric(12,4) check (opening_odds > 1),
  closing_odds     numeric(12,4) check (closing_odds > 1),
  closing_source   text,                                      -- 'manual' | '<provider>:<bookmaker key>'
  closing_captured_at timestamptz,
  -- classification
  strategy_id      uuid references strategies(id) on delete set null,
  confidence       smallint check (confidence between 1 and 5),
  units            numeric(8,2) check (units > 0),
  tags             text[] not null default '{}',
  notes            text check (char_length(notes) <= 4000),
  correlation_group text check (char_length(correlation_group) <= 60),
  import_hash      text,                                      -- duplicate detection on import
  deleted_at       timestamptz,                               -- soft delete; history preserved
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (cashed_out_stake <= stake),
  check (status <> 'cashed_out' or cashed_out_stake = stake),
  check ((status = 'pending') = (profit is null)),
  check (side = 'back' or (cashed_out_stake = 0 and kind = 'single'))
);
create unique index bets_client_ref_uq on bets (user_id, client_ref) where client_ref is not null;
create unique index bets_import_hash_uq on bets (user_id, is_demo, import_hash) where import_hash is not null and deleted_at is null;
create index bets_user_placed_idx on bets (user_id, is_demo, placed_at desc) where deleted_at is null;
create index bets_user_status_idx on bets (user_id, is_demo, status) where deleted_at is null;
create index bets_bankroll_idx on bets (bankroll_id);
create index bets_strategy_idx on bets (strategy_id);
create index bets_event_idx on bets (event_id);
create index bets_tags_idx on bets using gin (tags);

create table bet_legs (
  id              uuid primary key default gen_random_uuid(),
  bet_id          uuid not null references bets(id) on delete cascade,
  leg_no          smallint not null check (leg_no between 1 and 30),
  sport_id        uuid references sports(id),
  event_id        uuid references events(id) on delete set null,
  event_name      text not null,
  event_start     timestamptz,
  market          text not null,
  selection       text not null,
  line            numeric(8,2),
  odds            numeric(12,4) not null check (odds > 1),
  closing_odds    numeric(12,4) check (closing_odds > 1),
  status          leg_status not null default 'pending',
  unique (bet_id, leg_no)
);

create table bet_notes (
  id         uuid primary key default gen_random_uuid(),
  bet_id     uuid not null references bets(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index bet_notes_bet_idx on bet_notes (bet_id, created_at);

-- ── Live trading ─────────────────────────────────────────────────────────────
create table trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  is_demo       boolean not null default false,
  bankroll_id   uuid not null references bankrolls(id),
  sport_id      uuid not null references sports(id),
  event_id      uuid references events(id) on delete set null,
  event_name    text not null check (char_length(event_name) between 1 and 300),
  market        text not null,
  selection     text not null,
  bookmaker_id  uuid references bookmakers(id) on delete set null,
  currency      char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate       numeric(18,8) not null default 1 check (fx_rate > 0),
  commission    numeric(6,5) not null default 0 check (commission >= 0 and commission < 1),
  is_live       boolean not null default true,
  strategy_id   uuid references strategies(id) on delete set null,
  status        trade_status not null default 'open',
  outcome       trade_outcome,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  realized_pnl  numeric(16,2),
  notes         text check (char_length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  check ((status = 'open') = (realized_pnl is null))
);
create index trades_user_idx on trades (user_id, is_demo, opened_at desc);

create table trade_executions (
  id           uuid primary key default gen_random_uuid(),
  trade_id     uuid not null references trades(id) on delete cascade,
  side         execution_side not null,
  odds         numeric(12,4) check (odds > 1),          -- null for cashout
  stake        numeric(16,2) not null check (stake > 0), -- for cashout: the back stake being closed
  amount       numeric(16,2) check (amount >= 0),        -- cashout amount received
  executed_at  timestamptz not null default now(),
  note         text check (char_length(note) <= 500),
  check ((side = 'cashout') = (odds is null)),
  check ((side = 'cashout') = (amount is not null))
);
create index trade_executions_trade_idx on trade_executions (trade_id, executed_at);

-- ── Ledger ───────────────────────────────────────────────────────────────────
create table bankroll_transactions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  is_demo         boolean not null default false,
  bankroll_id     uuid not null references bankrolls(id) on delete cascade,
  type            tx_type not null,
  amount          numeric(16,2) not null check (amount <> 0 or type = 'bet_settlement'),  -- signed, bankroll ccy
  balance_after   numeric(16,2) not null,
  bet_id          uuid references bets(id) on delete set null,
  trade_id        uuid references trades(id) on delete set null,
  settlement_seq  int,
  transfer_group  uuid,
  fx_rate         numeric(18,8),
  original_amount numeric(16,2),
  original_currency char(3),
  note            text check (char_length(note) <= 500),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index bankroll_tx_bankroll_idx on bankroll_transactions (bankroll_id, occurred_at, id);
create index bankroll_tx_user_idx on bankroll_transactions (user_id, is_demo, occurred_at desc);
create index bankroll_tx_bet_idx on bankroll_transactions (bet_id);
-- A bet can be settled at most once per settlement cycle (reopen increments the cycle).
create unique index bankroll_tx_one_settlement on bankroll_transactions (bet_id, settlement_seq) where type = 'bet_settlement';
create unique index bankroll_tx_one_trade_settlement on bankroll_transactions (trade_id) where type = 'trade_settlement';

-- ── Risk, goals, alerts, snapshots, saved views, audit ──────────────────────
create table risk_limits (
  user_id                uuid not null references auth.users(id) on delete cascade,
  is_demo                boolean not null default false,
  max_stake_per_bet      numeric(16,2) check (max_stake_per_bet > 0),
  max_bet_pct_bankroll   numeric(6,5)  check (max_bet_pct_bankroll > 0 and max_bet_pct_bankroll <= 1),
  max_event_exposure     numeric(16,2) check (max_event_exposure > 0),
  max_total_exposure_pct numeric(6,5)  check (max_total_exposure_pct > 0 and max_total_exposure_pct <= 1),
  max_daily_loss         numeric(16,2) check (max_daily_loss > 0),
  max_weekly_loss        numeric(16,2) check (max_weekly_loss > 0),
  max_drawdown_pct       numeric(6,5)  check (max_drawdown_pct > 0 and max_drawdown_pct <= 1),
  max_correlated_exposure numeric(16,2) check (max_correlated_exposure > 0),
  enforce                boolean not null default false,   -- true = block bets that breach a limit
  updated_at             timestamptz not null default now(),
  primary key (user_id, is_demo)
);

create table goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  is_demo      boolean not null default false,
  name         text not null check (char_length(name) between 1 and 80),
  metric       text not null check (metric in ('profit','roi','bankroll','clv','bets','win_rate')),
  target       numeric(16,4) not null,
  bankroll_id  uuid references bankrolls(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  achieved_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);

create table alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  is_demo     boolean not null default false,
  type        text not null check (type in (
                'bet_settled','large_result','daily_loss','weekly_loss','drawdown','odds_movement',
                'clv_update','api_failure','exposure','stake_limit','goal_progress','system')),
  severity    alert_severity not null default 'info',
  title       text not null,
  body        text,
  data        jsonb not null default '{}'::jsonb,
  dedupe_key  text,
  read_at     timestamptz,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index alerts_dedupe_uq on alerts (user_id, dedupe_key) where dedupe_key is not null;
create index alerts_user_idx on alerts (user_id, is_demo, created_at desc);

create table performance_snapshots (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  is_demo       boolean not null default false,
  bankroll_id   uuid not null references bankrolls(id) on delete cascade,
  snapshot_date date not null,
  balance       numeric(16,2) not null,
  open_exposure numeric(16,2) not null,
  equity        numeric(16,2) not null,         -- balance + open bet reservations
  net_deposits  numeric(16,2) not null,         -- cumulative capital flows
  cum_profit    numeric(16,2) not null,         -- cumulative settled betting profit
  cum_staked    numeric(16,2) not null,
  settled_bets  int not null,
  peak_equity   numeric(16,2) not null,
  drawdown_pct  numeric(9,6) not null,
  created_at    timestamptz not null default now(),
  unique (bankroll_id, snapshot_date)
);

create table saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  scope      text not null default 'bets',
  name       text not null check (char_length(name) between 1 and 60),
  config     jsonb not null,   -- filters, sort, visible columns
  created_at timestamptz not null default now(),
  unique (user_id, scope, name)
);

create table audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid,                             -- no FK: audit rows outlive deleted users
  actor       text not null default 'user',     -- 'user' | 'system' | 'service'
  entity      text not null,
  entity_id   text not null,
  action      text not null,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index audit_logs_user_idx on audit_logs (user_id, at desc);
create index audit_logs_entity_idx on audit_logs (entity, entity_id, at desc);
