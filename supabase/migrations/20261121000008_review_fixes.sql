-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0008 review fixes
--   1. Live trading: exposure is reserved in the ledger on every execution, released on
--      hedges / partial closes, and settled against the reservation (no double counting).
--   2. Accumulators: result derived from the actual payout (won / partial_win / break_even /
--      partial_loss / lost / void); leg results can be recorded progressively.
--   3. Leagues: resolved by name (import, demo), more platform competitions.
--   4. Notifications: per-type in-app/email preferences, transactional email outbox with
--      retries, delivery events, CLV-update and bet-settled alerts.
--   5. Odds connections: richer status, stored test results, last odds update.
--   6. Settings for date basis and risk-adjusted metric conventions.
-- ════════════════════════════════════════════════════════════════════════════

-- ── DDL ─────────────────────────────────────────────────────────────────────
alter table trades
  add column reserved numeric(16,2) not null default 0,               -- current reservation, trade currency
  add column reserved_base numeric(16,2) not null default 0,          -- same, bankroll currency (as posted)
  add column realized_partial numeric(16,2) not null default 0,       -- realised by partial closes, trade currency
  add column realized_partial_base numeric(16,2) not null default 0,  -- same, bankroll currency (as posted)
  add column league_id uuid references leagues(id) on delete set null;

alter table bankroll_transactions drop constraint if exists bankroll_transactions_check;
alter table bankroll_transactions drop constraint if exists bankroll_transactions_amount_check;
alter table bankroll_transactions add constraint bankroll_transactions_amount_check
  check (amount <> 0 or type in ('bet_settlement','trade_settlement'));

alter table user_settings
  add column date_basis text not null default 'placed' check (date_basis in ('placed','event','settled')),
  add column notification_email text check (notification_email is null or notification_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column notification_prefs jsonb not null default '{}'::jsonb,
  add column risk_free_rate numeric(7,5) not null default 0 check (risk_free_rate > -1 and risk_free_rate < 1),
  add column sortino_mar numeric(7,5) not null default 0 check (sortino_mar > -1 and sortino_mar < 1),
  add column annualization_days int not null default 365 check (annualization_days in (252, 365));

alter table alerts add column in_app boolean not null default true;
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in (
  'bet_settled','large_result','large_profit','large_loss','daily_loss','weekly_loss','drawdown','odds_movement',
  'clv_update','api_failure','exposure','stake_limit','goal_progress','system'));

alter table api_connections drop constraint if exists api_connections_status_check;
alter table api_connections add constraint api_connections_status_check check (status in
  ('untested','ok','error','auth_error','rate_limited','unreachable','invalid_response','outage'));
alter table api_connections
  add column last_test_result jsonb,
  add column last_odds_at timestamptz,
  add column last_odds_events int;

-- Transactional email outbox. Rows are created by trigger (same transaction as the alert),
-- delivered by the server worker with retries, and updated by the provider webhook.
create table email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  alert_id            uuid references alerts(id) on delete set null,
  kind                text not null default 'alert' check (kind in ('alert','test')),
  alert_type          text,
  to_email            text not null,
  subject             text not null,
  body                text,
  status              text not null default 'queued' check (status in ('queued','sending','sent','delivered','failed','bounced')),
  attempts            int not null default 0,
  max_attempts        int not null default 5,
  next_attempt_at     timestamptz not null default now(),
  provider            text,
  provider_message_id text,
  last_error          text,
  dedupe_key          text not null,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  updated_at          timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index email_outbox_due_idx on email_outbox (next_attempt_at) where status in ('queued','sending');
create index email_outbox_user_idx on email_outbox (user_id, created_at desc);
create index email_outbox_provider_idx on email_outbox (provider_message_id) where provider_message_id is not null;

create table email_events (
  id          bigint generated always as identity primary key,
  outbox_id   uuid not null references email_outbox(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null,
  http_status int,
  detail      text,
  at          timestamptz not null default now()
);
create index email_events_outbox_idx on email_events (outbox_id, at);

alter table email_outbox enable row level security; alter table email_outbox force row level security;
alter table email_events enable row level security; alter table email_events force row level security;
revoke all on email_outbox, email_events from anon, authenticated;
grant select on email_outbox, email_events to authenticated;
create policy email_outbox_own on email_outbox for select to authenticated using (user_id = auth.uid());
create policy email_events_own on email_events for select to authenticated using (user_id = auth.uid());
grant update (date_basis, notification_email, notification_prefs, risk_free_rate, sortino_mar, annualization_days) on user_settings to authenticated;

-- ── Leagues ─────────────────────────────────────────────────────────────────
create or replace function private.resolve_league(p jsonb, p_user uuid, p_sport uuid) returns uuid
language plpgsql as $$
declare v uuid; n text := nullif(trim(coalesce(p->>'league_name', p->>'league')), '');
begin
  if nullif(p->>'league_id','') is not null then
    select id into v from leagues where id = (p->>'league_id')::uuid and (owner_id is null or owner_id = p_user);
    return v;
  end if;
  if n is null or p_sport is null then return null; end if;
  select id into v from leagues where lower(name) = lower(n) and sport_id = p_sport and (owner_id is null or owner_id = p_user)
   order by owner_id nulls last limit 1;
  if v is null then   -- unknown competition on import: create a private league under the bet's sport
    insert into leagues (owner_id, sport_id, name) values (p_user, p_sport, left(n, 120)) on conflict do nothing returning id into v;
    if v is null then select id into v from leagues where owner_id = p_user and sport_id = p_sport and lower(name) = lower(n); end if;
  end if;
  return v;
end $$;

insert into leagues (sport_id, name, country, provider_keys)
select s.id, l.name, l.country, l.pk::jsonb from (values
  ('football','UEFA Europa League','Europe','{"the_odds_api":"soccer_uefa_europa_league","api_football":"3"}'),
  ('football','Slovenian PrvaLiga','Slovenia','{"api_football":"373"}'),
  ('basketball','EuroCup','Europe','{}'),
  ('basketball','NCAA','USA','{"the_odds_api":"basketball_ncaab"}'),
  ('tennis','Grand Slam','World','{}'),
  ('tennis','Challenger Tour','World','{}'),
  ('ice_hockey','KHL','Russia','{}'),
  ('ice_hockey','SHL','Sweden','{"the_odds_api":"icehockey_sweden_hockey_league"}'),
  ('baseball','NPB','Japan','{"the_odds_api":"baseball_npb"}'),
  ('american_football','NCAA Football','USA','{"the_odds_api":"americanfootball_ncaaf"}'),
  ('rugby','Premiership Rugby','England','{}'),
  ('rugby','NRL','Australia','{"the_odds_api":"rugbyleague_nrl"}'),
  ('cricket','ICC Cricket World Cup','World','{}'),
  ('cricket','The Ashes','World','{}'),
  ('volleyball','CEV Champions League','Europe','{}'),
  ('volleyball','Italian SuperLega','Italy','{}'),
  ('handball','EHF Champions League','Europe','{}'),
  ('handball','Handball-Bundesliga','Germany','{}'),
  ('mma','Bellator','World','{}'),
  ('boxing','World Title Fights','World','{"the_odds_api":"boxing_boxing"}'),
  ('golf','PGA Tour','USA','{}'),
  ('golf','DP World Tour','Europe','{}'),
  ('table_tennis','WTT Champions','World','{}'),
  ('esports','League of Legends Worlds','World','{}'),
  ('esports','CS2 Major','World','{}'),
  ('darts','PDC World Championship','World','{}'),
  ('darts','Premier League Darts','England','{}'),
  ('badminton','BWF World Tour','World','{}')
) as l(sport, name, country, pk)
join sports s on s.key = l.sport and s.owner_id is null
on conflict do nothing;

-- ── Notification preferences ────────────────────────────────────────────────
-- Defaults: every type in-app (bet_settled off to avoid noise); email is opt-in per type.
create or replace function private.notify_pref(p_user uuid, p_type text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'in_app', coalesce((s.notification_prefs->p_type->>'in_app')::boolean, p_type <> 'bet_settled'),
    'email',  coalesce((s.notification_prefs->p_type->>'email')::boolean, false))
  from (select coalesce((select notification_prefs from user_settings where user_id = p_user), '{}'::jsonb) as notification_prefs) s;
$$;

create or replace function private.alert_apply_prefs() returns trigger
language plpgsql security definer set search_path = public as $$
declare pref jsonb := private.notify_pref(new.user_id, case when new.type = 'large_result' then 'large_loss' else new.type end);
begin
  if not (pref->>'in_app')::boolean and not (pref->>'email')::boolean then return null; end if;   -- user opted out
  new.in_app := (pref->>'in_app')::boolean;
  return new;
end $$;
create trigger alerts_apply_prefs before insert on alerts for each row execute function private.alert_apply_prefs();

-- Same transaction as the alert: an email is queued iff the alert exists and the user opted in.
-- Demo-workspace alerts never send email.
create or replace function private.alert_enqueue_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_to text;
begin
  if new.is_demo or not (private.notify_pref(new.user_id, new.type)->>'email')::boolean then return new; end if;
  select coalesce(s.notification_email, p.email) into v_to from profiles p left join user_settings s on s.user_id = p.id where p.id = new.user_id;
  if v_to is null then return new; end if;
  insert into email_outbox (user_id, alert_id, kind, alert_type, to_email, subject, body, dedupe_key)
  values (new.user_id, new.id, 'alert', new.type, v_to, '[Betting Edge Pro] ' || new.title, new.body, 'alert:' || coalesce(new.dedupe_key, new.id::text))
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;
create trigger alerts_enqueue_email after insert on alerts for each row execute function private.alert_enqueue_email();

-- Test email: queued for the caller, rate limited to 5 per hour.
create or replace function public.queue_test_email() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); v_to text; v_id uuid;
begin
  select coalesce(s.notification_email, p.email) into v_to from profiles p left join user_settings s on s.user_id = p.id where p.id = v_user;
  if v_to is null then raise exception 'VALIDATION: no notification email address configured'; end if;
  if (select count(*) from email_outbox where user_id = v_user and kind = 'test' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'VALIDATION: test email limit reached (5 per hour)';
  end if;
  insert into email_outbox (user_id, kind, to_email, subject, body, dedupe_key, max_attempts)
  values (v_user, 'test', v_to, '[Betting Edge Pro] Test email', 'This is a test notification from Betting Edge Pro. If you can read it, email delivery works.',
          'test:' || gen_random_uuid(), 1)
  returning id into v_id;
  return v_id;
end $$;

-- Worker: claim due emails (skip-locked so concurrent workers never send twice).
-- Rows stuck in 'sending' for 10 minutes (crashed worker) are reclaimed.
create or replace function public.claim_email_batch(p_limit int default 20, p_only uuid default null) returns setof email_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update email_outbox o set status = 'sending', attempts = o.attempts + 1, updated_at = now()
   where o.id in (
     select id from email_outbox
      where (p_only is null or id = p_only)
        and ((status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and updated_at < now() - interval '10 minutes'))
        and attempts < max_attempts
      order by next_attempt_at limit p_limit for update skip locked)
  returning o.*;
end $$;
revoke execute on function public.claim_email_batch(int, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_batch(int, uuid) to service_role;

-- ── Trading: reservation accounting ─────────────────────────────────────────
-- Open-position scenarios EXCLUDING already-realised partial closes:
--   win_open  = Σback s(o−1)·(1 − cashed share) − Σlay s(o−1)
--   lose_open = −(Σback s − cashed stake) + Σlay s
-- Required reservation = max(0, −min(win_open, lose_open)): the worst case still at risk.
create or replace function private.trade_open_scenarios(p_trade uuid, out win numeric, out lose numeric, out realized numeric)
language plpgsql stable as $$
declare bs numeric; bw numeric; lw numeric; ls numeric; cs numeric; ca numeric;
begin
  select coalesce(sum(stake) filter (where side = 'back'), 0), coalesce(sum(stake * (odds - 1)) filter (where side = 'back'), 0),
         coalesce(sum(stake * (odds - 1)) filter (where side = 'lay'), 0), coalesce(sum(stake) filter (where side = 'lay'), 0),
         coalesce(sum(stake) filter (where side = 'cashout'), 0), coalesce(sum(amount) filter (where side = 'cashout'), 0)
    into bs, bw, lw, ls, cs, ca from trade_executions where trade_id = p_trade;
  win := (case when bs > 0 then bw * (1 - cs / bs) else 0 end) - lw;
  lose := -(bs - cs) + ls;
  realized := ca - cs;
end $$;

-- Bring the trade's ledger reservation to the required level (hold more or release).
create or replace function private.trade_sync_reservation(p_user uuid, p_trade uuid, p_at timestamptz, p_note text default null) returns trades
language plpgsql as $$
declare t trades; s record; v_req numeric; v_req_base numeric; v_delta numeric;
begin
  select * into t from trades where id = p_trade for update;
  if t.status <> 'open' then return t; end if;
  select * into s from private.trade_open_scenarios(p_trade);
  v_req := round(greatest(0, -least(s.win, s.lose)), 2);
  v_req_base := round(v_req * t.fx_rate, 2);
  v_delta := v_req_base - t.reserved_base;
  if v_delta <> 0 then
    perform private.post_tx(p_user, t.bankroll_id, 'trade_reservation', -v_delta, null, t.id,
      coalesce(p_note, case when v_delta > 0 then 'Exposure reserved' else 'Exposure released' end), coalesce(p_at, now()));
  end if;
  update trades set reserved = v_req, reserved_base = v_req_base where id = t.id returning * into t;
  return t;
end $$;

create or replace function private.add_trade_execution(p_user uuid, p_trade uuid, p_side execution_side, p_odds numeric, p_stake numeric,
  p_amount numeric default null, p_executed_at timestamptz default null, p_note text default null)
returns trade_executions language plpgsql as $$
declare t trades; e trade_executions; v_back numeric; v_cashed numeric; v_real numeric; v_real_base numeric;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.user_id <> p_user then raise exception 'NOT_FOUND: trade not found'; end if;
  if t.status <> 'open' then raise exception 'VALIDATION: trade is closed'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'VALIDATION: stake must be > 0'; end if;
  if p_side <> 'cashout' and (p_odds is null or p_odds <= 1) then raise exception 'VALIDATION: odds must be > 1'; end if;
  if p_side = 'cashout' then
    if p_amount is null or p_amount < 0 then raise exception 'VALIDATION: cash-out amount must be >= 0'; end if;
    select coalesce(sum(stake) filter (where side = 'back'), 0), coalesce(sum(stake) filter (where side = 'cashout'), 0)
      into v_back, v_cashed from trade_executions where trade_id = t.id;
    if round(p_stake, 2) > v_back - v_cashed then
      raise exception 'VALIDATION: cash-out stake % exceeds open back stake %', p_stake, v_back - v_cashed;
    end if;
  end if;
  insert into trade_executions (trade_id, side, odds, stake, amount, executed_at, note)
  values (t.id, p_side, case when p_side = 'cashout' then null else p_odds end, round(p_stake, 2),
          case when p_side = 'cashout' then round(p_amount, 2) end, coalesce(p_executed_at, now()), p_note)
  returning * into e;
  -- reservation first (a release on partial close), then the realised P/L of the closed part
  perform private.trade_sync_reservation(p_user, t.id, e.executed_at,
    case when p_side = 'cashout' then 'Exposure released (partial close)' else null end);
  if p_side = 'cashout' then
    v_real := e.amount - e.stake;
    v_real_base := round(v_real * t.fx_rate, 2);
    if v_real_base <> 0 then
      perform private.post_tx(p_user, t.bankroll_id, 'trade_cashout', v_real_base, null, t.id,
        format('Partial close: %s stake for %s', e.stake, e.amount), e.executed_at);
    end if;
    update trades set realized_partial = realized_partial + v_real, realized_partial_base = realized_partial_base + v_real_base where id = t.id;
  end if;
  return e;
end $$;

-- Final close: release the remaining reservation and post the rest of the realised P/L.
--   total P/L (commission on positive net market P/L) = trade_pnl(outcome) [× (1 − c)]
--   credit = reserved_base + round(total × fx) − realised_partial_base   (always posted, may be 0)
create or replace function private.settle_trade(p_user uuid, p_trade uuid, p_outcome trade_outcome, p_closed_at timestamptz default null)
returns trades language plpgsql as $$
declare t trades; v_pnl numeric; v_credit numeric;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.user_id <> p_user then raise exception 'NOT_FOUND: trade not found'; end if;
  if t.status <> 'open' then raise exception 'ALREADY_SETTLED: trade is already settled'; end if;
  v_pnl := private.trade_pnl(t.id, p_outcome);
  if v_pnl > 0 and p_outcome <> 'void' then v_pnl := v_pnl * (1 - t.commission); end if;
  v_pnl := round(v_pnl, 2);
  v_credit := t.reserved_base + round(v_pnl * t.fx_rate, 2) - t.realized_partial_base;
  perform private.post_tx(p_user, t.bankroll_id, 'trade_settlement', v_credit, null, t.id,
    format('Trade closed (%s): reservation %s released, P/L %s', p_outcome, t.reserved_base, round(v_pnl * t.fx_rate, 2)), coalesce(p_closed_at, now()));
  update trades set status = case when p_outcome = 'void' then 'void' else 'settled' end::trade_status, outcome = p_outcome,
                    realized_pnl = v_pnl, closed_at = coalesce(p_closed_at, now()), reserved = 0, reserved_base = 0
   where id = t.id returning * into t;
  return t;
end $$;

create or replace function public.open_trade(p jsonb) returns trades
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); b bankrolls; t trades; v_ccy char(3); v_ex jsonb; v_sport uuid;
begin
  b := private.lock_bankroll((p->>'bankroll_id')::uuid, v_user);
  v_ccy := upper(coalesce(nullif(p->>'currency',''), b.currency));
  v_sport := private.resolve_sport(p, v_user);
  insert into trades (user_id, is_demo, bankroll_id, sport_id, league_id, event_id, event_name, market, selection, bookmaker_id, currency, fx_rate,
                      commission, is_live, strategy_id, notes, opened_at)
  values (v_user, b.is_demo, b.id, v_sport, private.resolve_league(p, v_user, v_sport), nullif(p->>'event_id','')::uuid, trim(p->>'event_name'),
          coalesce(nullif(p->>'market',''), 'Match Odds'), trim(p->>'selection'), private.resolve_bookmaker(p, v_user), v_ccy,
          case when v_ccy = b.currency then 1 else coalesce(nullif(p->>'fx_rate','')::numeric, private.fx_rate(v_ccy, b.currency, current_date, v_user)) end,
          coalesce(nullif(p->>'commission','')::numeric, 0), coalesce((p->>'is_live')::boolean, true),
          private.resolve_strategy(p, v_user, b.is_demo), nullif(p->>'notes',''), coalesce(nullif(p->>'opened_at','')::timestamptz, now()))
  returning * into t;
  for v_ex in select * from jsonb_array_elements(coalesce(p->'executions', '[]'::jsonb)) loop
    perform private.add_trade_execution(v_user, t.id, (v_ex->>'side')::execution_side, nullif(v_ex->>'odds','')::numeric,
                                        (v_ex->>'stake')::numeric, nullif(v_ex->>'amount','')::numeric,
                                        nullif(v_ex->>'executed_at','')::timestamptz, v_ex->>'note');
  end loop;
  select * into t from trades where id = t.id;
  return t;
end $$;

create or replace function public.add_trade_execution(p_trade uuid, p_side execution_side, p_odds numeric, p_stake numeric,
  p_amount numeric default null, p_executed_at timestamptz default null, p_note text default null)
returns trade_executions language plpgsql security definer set search_path = public as $$
begin return private.add_trade_execution(private.require_user(), p_trade, p_side, p_odds, p_stake, p_amount, p_executed_at, p_note); end $$;

create or replace function public.settle_trade(p_trade uuid, p_outcome trade_outcome, p_closed_at timestamptz default null)
returns trades language plpgsql security definer set search_path = public as $$
begin return private.settle_trade(private.require_user(), p_trade, p_outcome, p_closed_at); end $$;

-- ── Accumulators: record leg results progressively ─────────────────────────
-- Saves leg results; settles automatically once a leg loses or every leg is decided.
create or replace function public.set_leg_results(p_bet uuid, p_legs jsonb) returns bets
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); r bets; v_leg jsonb;
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> v_user or r.deleted_at is not null then raise exception 'NOT_FOUND: bet not found'; end if;
  if r.kind <> 'accumulator' then raise exception 'VALIDATION: only accumulators have legs'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_SETTLED: bet #% is already settled; reopen it first', r.ref; end if;
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    update bet_legs set status = (v_leg->>'status')::leg_status where bet_id = r.id and leg_no = (v_leg->>'leg_no')::int;
  end loop;
  if exists (select 1 from bet_legs where bet_id = r.id and status = 'lost')
     or not exists (select 1 from bet_legs where bet_id = r.id and status = 'pending') then
    return private.settle_bet(v_user, r.id, null, null, null, now(), null, true);
  end if;
  update bets set updated_at = now() where id = r.id returning * into r;
  return r;
end $$;

-- ── Closing odds capture → CLV-update alert ─────────────────────────────────
create or replace function private.capture_closing_odds(p_user uuid) returns int
language plpgsql as $$
declare n int; v_avg numeric; v_demo boolean;
begin
  with ref as (select clv_reference_bookmaker as bk from user_settings where user_id = p_user),
  cand as (
    select b.id as bet_id,
      (select s.odds || '|' || bk.key from odds_snapshots s join bookmakers bk on bk.id = s.bookmaker_id
        where s.market_id = b.market_id and lower(s.selection) = lower(b.selection)
          and s.bookmaker_id = coalesce((select bk from ref), b.bookmaker_id)
          and (s.is_closing or s.captured_at <= coalesce(b.event_start, 'infinity'::timestamptz)) and not s.is_live
        order by s.is_closing desc, s.captured_at desc limit 1) as px
    from bets b
    where b.user_id = p_user and b.market_id is not null and b.closing_odds is null and b.deleted_at is null
      and b.kind = 'single' and coalesce(b.event_start, now()) <= now()
  ), upd as (
    update bets b set closing_odds = split_part(c.px, '|', 1)::numeric,
                      closing_source = 'snapshot:' || split_part(c.px, '|', 2), closing_captured_at = now()
      from cand c where c.bet_id = b.id and c.px is not null
    returning b.odds, b.closing_odds, b.side, b.is_demo
  )
  select count(*), avg(case when side = 'lay' then closing_odds / odds - 1 else odds / closing_odds - 1 end), bool_or(is_demo)
    into n, v_avg, v_demo from upd;
  if n > 0 then
    insert into alerts (user_id, is_demo, type, severity, title, body, data, dedupe_key)
    values (p_user, coalesce(v_demo, false), 'clv_update', 'info', format('Closing prices captured for %s bet(s)', n),
            format('Average CLV of these bets (odds-based, taken/closing − 1): %s%%', round(v_avg * 100, 2)),
            jsonb_build_object('count', n, 'avg_clv', v_avg), 'clv:' || to_char(now(), 'YYYYMMDDHH24MI') || ':' || n);
  end if;
  return n;
end $$;
create or replace function private.post_tx(
  p_user uuid, p_bankroll uuid, p_type tx_type, p_amount numeric,
  p_bet uuid default null, p_trade uuid default null, p_note text default null,
  p_occurred_at timestamptz default now(), p_settlement_seq int default null,
  p_transfer_group uuid default null, p_fx_rate numeric default null,
  p_original_amount numeric default null, p_original_currency char(3) default null
) returns bankroll_transactions
language plpgsql as $$
declare
  b bankrolls;
  t bankroll_transactions;
  v_amount numeric := round(p_amount, 2);
begin
  b := private.lock_bankroll(p_bankroll, p_user);
  if b.archived then raise exception 'ARCHIVED: bankroll "%" is archived', b.name; end if;
  if v_amount < 0 and not b.allow_negative and b.balance + v_amount < 0
     and p_type in ('withdrawal','bet_placement','transfer_out','trade_reservation') then
    raise exception 'INSUFFICIENT_FUNDS: bankroll "%" balance % % is less than %', b.name, b.balance, b.currency, -v_amount
      using errcode = 'P0001';
  end if;
  perform set_config('bep.ledger', 'on', true);
  update bankrolls set balance = balance + v_amount where id = b.id;
  perform set_config('bep.ledger', 'off', true);
  insert into bankroll_transactions (user_id, is_demo, bankroll_id, type, amount, balance_after, bet_id, trade_id,
                                     settlement_seq, transfer_group, fx_rate, original_amount, original_currency, note, occurred_at)
  values (p_user, b.is_demo, b.id, p_type, v_amount, b.balance + v_amount, p_bet, p_trade,
          p_settlement_seq, p_transfer_group, p_fx_rate, p_original_amount, p_original_currency, p_note, coalesce(p_occurred_at, now()))
  returning * into t;
  return t;
end $$;

create or replace function private.place_bet(p_user uuid, p jsonb) returns bets
language plpgsql as $$
declare
  b bankrolls;
  r bets;
  v_existing bets;
  v_demo boolean;
  v_legs jsonb := coalesce(p->'legs', '[]'::jsonb);
  v_kind bet_kind;
  v_side bet_side := coalesce(nullif(p->>'side',''), 'back')::bet_side;
  v_odds numeric;
  v_stake numeric := round((p->>'stake')::numeric, 2);
  v_comm numeric := coalesce(nullif(p->>'commission','')::numeric, 0);
  v_ccy char(3);
  v_fx numeric;
  v_placed timestamptz := coalesce(nullif(p->>'placed_at','')::timestamptz, now());
  v_book uuid;
  v_sport uuid;
  v_leg jsonb;
  v_i int := 0;
  v_status bet_status := coalesce(nullif(p->>'status',''), 'pending')::bet_status;
  v_reservation numeric;
  v_hash text;
begin
  if nullif(p->>'client_ref','') is not null then
    select * into v_existing from bets where user_id = p_user and client_ref = (p->>'client_ref')::uuid;
    if found then return v_existing; end if;    -- idempotent retry
  end if;

  b := private.lock_bankroll((p->>'bankroll_id')::uuid, p_user);
  v_demo := b.is_demo;
  if v_stake is null or v_stake <= 0 then raise exception 'VALIDATION: stake must be greater than 0'; end if;
  if v_comm < 0 or v_comm >= 1 then raise exception 'VALIDATION: commission must be in [0, 1)'; end if;

  if jsonb_array_length(v_legs) > 1 then
    v_kind := 'accumulator';
    if v_side = 'lay' then raise exception 'VALIDATION: accumulators cannot be lay bets'; end if;
    v_odds := 1;
    for v_leg in select * from jsonb_array_elements(v_legs) loop
      if (v_leg->>'odds')::numeric is null or (v_leg->>'odds')::numeric <= 1 then
        raise exception 'VALIDATION: every leg needs decimal odds > 1';
      end if;
      v_odds := v_odds * (v_leg->>'odds')::numeric;
    end loop;
    v_odds := round(v_odds, 4);
  else
    v_kind := 'single';
    v_odds := (p->>'odds')::numeric;
  end if;
  if v_odds is null or v_odds <= 1 then raise exception 'VALIDATION: decimal odds must be greater than 1'; end if;

  v_ccy := upper(coalesce(nullif(p->>'currency',''), b.currency));
  v_fx := case when v_ccy = b.currency then 1
               when nullif(p->>'fx_rate','') is not null then (p->>'fx_rate')::numeric
               else private.fx_rate(v_ccy, b.currency, v_placed::date, p_user) end;
  v_book := private.resolve_bookmaker(p, p_user);
  v_sport := private.resolve_sport(p, p_user);
  v_reservation := round(private.bet_liability(v_side, v_odds, v_stake) * v_fx, 2);
  if v_status = 'pending' then
    perform private.check_risk_limits(p_user, b, v_reservation, nullif(p->>'event_id','')::uuid, p->>'event_name', null);
  end if;

  v_hash := private.bet_fingerprint(v_placed, p->>'event_name', coalesce(nullif(p->>'market',''), 'Match Winner'), p->>'selection', v_odds, v_stake, v_book);
  if coalesce((p->>'check_duplicate')::boolean, false)
     and exists (select 1 from bets where user_id = p_user and is_demo = v_demo and import_hash = v_hash and deleted_at is null) then
    raise exception 'DUPLICATE: an identical bet already exists' using errcode = '23505';
  end if;

  insert into bets (
    user_id, is_demo, bankroll_id, client_ref, kind, side, placed_at, sport_id, league_id, event_id, market_id,
    event_name, home, away, event_start, is_live, market_type_id, market_category, market, selection, line,
    bookmaker_id, odds, stake, currency, fx_rate, commission, liability, potential_payout,
    est_probability, opening_odds, closing_odds, closing_source, closing_captured_at,
    strategy_id, confidence, units, tags, notes, correlation_group, import_hash
  ) values (
    p_user, v_demo, b.id, nullif(p->>'client_ref','')::uuid, v_kind, v_side, v_placed, v_sport,
    private.resolve_league(p, p_user, v_sport), nullif(p->>'event_id','')::uuid, nullif(p->>'market_id','')::uuid,
    trim(p->>'event_name'), nullif(trim(p->>'home'),''), nullif(trim(p->>'away'),''), nullif(p->>'event_start','')::timestamptz,
    coalesce((p->>'is_live')::boolean, false), nullif(p->>'market_type_id','')::uuid, nullif(p->>'market_category',''),
    coalesce(nullif(trim(p->>'market'),''), case when v_kind = 'accumulator' then 'Accumulator' else 'Match Winner' end),
    coalesce(nullif(trim(p->>'selection'),''), case when v_kind = 'accumulator' then jsonb_array_length(v_legs) || '-fold' end),
    nullif(p->>'line','')::numeric,
    v_book, v_odds, v_stake, v_ccy, v_fx, v_comm,
    private.bet_liability(v_side, v_odds, v_stake), private.bet_potential_payout(v_side, v_odds, v_stake, v_comm),
    nullif(p->>'est_probability','')::numeric, nullif(p->>'opening_odds','')::numeric, nullif(p->>'closing_odds','')::numeric,
    case when nullif(p->>'closing_odds','') is not null then coalesce(nullif(p->>'closing_source',''), 'manual') end,
    case when nullif(p->>'closing_odds','') is not null then now() end,
    private.resolve_strategy(p, p_user, v_demo), nullif(p->>'confidence','')::smallint, nullif(p->>'units','')::numeric,
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb))), '{}'),
    nullif(p->>'notes',''), nullif(trim(p->>'correlation_group'),''), v_hash
  ) returning * into r;

  if v_kind = 'accumulator' then
    for v_leg in select * from jsonb_array_elements(v_legs) loop
      v_i := v_i + 1;
      insert into bet_legs (bet_id, leg_no, sport_id, event_id, event_name, event_start, market, selection, line, odds, closing_odds, status)
      values (r.id, v_i, coalesce(private.resolve_sport(v_leg, p_user), v_sport), nullif(v_leg->>'event_id','')::uuid,
              coalesce(nullif(trim(v_leg->>'event_name'),''), 'Leg ' || v_i), nullif(v_leg->>'event_start','')::timestamptz,
              coalesce(nullif(trim(v_leg->>'market'),''), 'Match Winner'), coalesce(nullif(trim(v_leg->>'selection'),''), '?'),
              nullif(v_leg->>'line','')::numeric, (v_leg->>'odds')::numeric, nullif(v_leg->>'closing_odds','')::numeric,
              coalesce(nullif(v_leg->>'status',''), 'pending')::leg_status);
    end loop;
  end if;

  perform private.post_tx(p_user, b.id, 'bet_placement', -v_reservation, r.id, null, null, v_placed,
                          null, null, case when v_fx <> 1 then v_fx end,
                          case when v_fx <> 1 then -private.bet_liability(v_side, v_odds, v_stake) end,
                          case when v_fx <> 1 then v_ccy end);

  -- Historical entry / import of an already-settled bet.
  if nullif(p->>'partial_cashout_stake','') is not null then
    r := private.partial_cashout(p_user, r.id, (p->>'partial_cashout_stake')::numeric, (p->>'partial_cashout_amount')::numeric, v_placed);
  end if;
  if v_status <> 'pending' or (v_kind = 'accumulator' and not exists (select 1 from bet_legs where bet_id = r.id and status = 'pending')) then
    r := private.settle_bet(p_user, r.id, v_status, null, null,
                            coalesce(nullif(p->>'settled_at','')::timestamptz, greatest(v_placed, coalesce(nullif(p->>'event_start','')::timestamptz, v_placed))),
                            nullif(p->>'cashout_amount','')::numeric, false);
  end if;
  return r;
end $$;

create or replace function private.settle_bet(
  p_user uuid, p_bet uuid, p_status bet_status, p_legs jsonb, p_closing_odds numeric,
  p_settled_at timestamptz, p_cashout_amount numeric, p_alerts boolean default true
) returns bets language plpgsql as $$
declare
  r bets;
  v_status bet_status := p_status;
  v_factor numeric;
  v_profit numeric;
  v_credit numeric;            -- returned to bankroll by this settlement, bet currency
  v_open numeric;
  v_final_cash numeric := 0;
  v_final_cash_stake numeric := 0;
  v_leg jsonb;
  v_pending int;
  v_lost int;
  v_nonvoid int;
  v_halves int;
  v_threshold numeric;
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> p_user or r.deleted_at is not null then
    raise exception 'NOT_FOUND: bet % not found', p_bet using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_SETTLED: bet #% is already settled as %; reopen it first', r.ref, r.status using errcode = 'P0001';
  end if;
  if v_status is null or v_status = 'pending' then
    if r.kind <> 'accumulator' then raise exception 'VALIDATION: a settlement status is required'; end if;
  end if;

  v_open := r.stake - r.cashed_out_stake;

  if v_status = 'cashed_out' then
    if p_cashout_amount is null or p_cashout_amount < 0 then
      raise exception 'VALIDATION: cash-out amount is required';
    end if;
    if r.side = 'lay' then raise exception 'VALIDATION: lay bets cannot be cashed out; use a hedge trade'; end if;
    v_final_cash := round(p_cashout_amount, 2);
    v_final_cash_stake := v_open;
    v_credit := v_final_cash;
    v_profit := round((r.cashout_amount + v_final_cash) - r.stake, 2);
  elsif r.kind = 'accumulator' then
    if p_legs is not null then
      for v_leg in select * from jsonb_array_elements(p_legs) loop
        update bet_legs set status = (v_leg->>'status')::leg_status
         where bet_id = r.id and leg_no = (v_leg->>'leg_no')::int;
      end loop;
    end if;
    select count(*) filter (where status = 'pending'), count(*) filter (where status = 'lost'),
           count(*) filter (where status <> 'void'), count(*) filter (where status in ('half_won','half_lost'))
      into v_pending, v_lost, v_nonvoid, v_halves from bet_legs where bet_id = r.id;
    if v_pending > 0 and v_lost = 0 then
      raise exception 'VALIDATION: % leg(s) still pending', v_pending;
    end if;
    v_factor := 1;
    declare l record; begin
      for l in select status, odds from bet_legs where bet_id = r.id and status <> 'pending' loop
        v_factor := v_factor * private.leg_factor(l.status::text, l.odds);
      end loop;
    end;
    if v_lost > 0 then v_factor := 0; end if;
    -- Result from the actual return (payout = open stake × Π leg factors), never from leg labels.
    v_status := case
      when v_lost > 0 or v_factor = 0 then 'lost'
      when v_nonvoid = 0 then 'void'
      when v_halves = 0 and v_factor > 1 then 'won'
      when v_factor > 1 then 'partial_win'
      when v_factor = 1 then 'break_even'
      else 'partial_loss' end;
    v_profit := private.bet_profit(r.side, r.odds, r.stake, r.commission, v_status, r.cashed_out_stake, r.cashout_amount, v_factor);
    v_credit := v_open + (v_profit - round(r.cashout_amount - r.cashed_out_stake, 2));
  else
    v_profit := private.bet_profit(r.side, r.odds, r.stake, r.commission, v_status, r.cashed_out_stake, r.cashout_amount, null);
    if r.side = 'lay' then
      v_credit := r.liability + v_profit;
    else
      v_credit := v_open + (v_profit - round(r.cashout_amount - r.cashed_out_stake, 2));
    end if;
  end if;

  update bets set
    status = v_status,
    profit = v_profit,
    actual_payout = round(r.cashout_amount + v_credit, 2),
    cashout_amount = r.cashout_amount + v_final_cash,
    cashed_out_stake = r.cashed_out_stake + v_final_cash_stake,
    settled_cashout_amount = v_final_cash,
    settled_cashout_stake = v_final_cash_stake,
    settled_at = coalesce(p_settled_at, now()),
    settle_count = r.settle_count + 1,
    closing_odds = coalesce(p_closing_odds, r.closing_odds),
    closing_source = case when p_closing_odds is not null then 'manual' else r.closing_source end,
    closing_captured_at = case when p_closing_odds is not null then now() else r.closing_captured_at end,
    updated_at = now()
  where id = r.id returning * into r;

  perform private.post_tx(p_user, r.bankroll_id, 'bet_settlement', round(v_credit * r.fx_rate, 2), r.id, null,
                          'Settled ' || v_status, coalesce(p_settled_at, now()), r.settle_count,
                          null, case when r.fx_rate <> 1 then r.fx_rate end, case when r.fx_rate <> 1 then v_credit end,
                          case when r.fx_rate <> 1 then r.currency end);

  if p_alerts then
    insert into alerts (user_id, is_demo, type, severity, title, body, data, dedupe_key)
    values (p_user, r.is_demo, 'bet_settled', 'info', format('Bet #%s settled: %s', r.ref, initcap(replace(v_status::text, '_', ' '))),
            format('%s — %s @ %s: P/L %s %s', r.event_name, r.selection, r.odds, to_char(v_profit, 'FMS999G999G990D00'), r.currency),
            jsonb_build_object('bet_id', r.id, 'profit', v_profit, 'status', v_status), 'bet_settled:' || r.id || ':' || r.settle_count)
    on conflict do nothing;
    select coalesce((alert_preferences->>'large_result')::numeric, 0) into v_threshold from user_settings where user_id = p_user;
    if v_threshold > 0 and abs(v_profit * r.fx_rate) >= v_threshold then
      insert into alerts (user_id, is_demo, type, severity, title, body, data, dedupe_key)
      values (p_user, r.is_demo, case when v_profit < 0 then 'large_loss' else 'large_profit' end, case when v_profit < 0 then 'warning' else 'info' end,
              case when v_profit < 0 then 'Large loss' else 'Large profit' end,
              format('Bet #%s %s — %s: %s %s', r.ref, r.event_name, r.selection, to_char(v_profit, 'FMS999G999G990D00'), r.currency),
              jsonb_build_object('bet_id', r.id, 'profit', v_profit), 'large_result:' || r.id || ':' || r.settle_count)
      on conflict do nothing;
    end if;
  end if;
  return r;
end $$;

create or replace function private.update_bet(p_user uuid, p_bet uuid, p jsonb) returns bets
language plpgsql as $$
declare
  r bets; b bankrolls;
  v_fin boolean := p ?| array['stake','odds','side','commission','bankroll_id','currency','fx_rate','legs'];
  v_side bet_side; v_odds numeric; v_stake numeric; v_comm numeric; v_bankroll uuid; v_ccy char(3); v_fx numeric;
  v_old_res numeric; v_new_res numeric; v_leg jsonb; v_i int := 0;
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> p_user or r.deleted_at is not null then raise exception 'NOT_FOUND: bet not found'; end if;

  if v_fin then
    v_side := coalesce(nullif(p->>'side','')::bet_side, r.side);
    v_odds := coalesce(nullif(p->>'odds','')::numeric, r.odds);
    v_stake := round(coalesce(nullif(p->>'stake','')::numeric, r.stake), 2);
    v_comm := coalesce(nullif(p->>'commission','')::numeric, r.commission);
    v_bankroll := coalesce(nullif(p->>'bankroll_id','')::uuid, r.bankroll_id);
    v_ccy := upper(coalesce(nullif(p->>'currency',''), r.currency));
    if v_side is distinct from r.side or v_odds <> r.odds or v_stake <> r.stake or v_comm <> r.commission
       or v_bankroll <> r.bankroll_id or v_ccy <> r.currency or (p ? 'legs') or (p ? 'fx_rate' and (p->>'fx_rate')::numeric <> r.fx_rate) then
      if r.status <> 'pending' then
        raise exception 'SETTLED_LOCKED: financial fields of a settled bet cannot be edited; reopen bet #% first', r.ref;
      end if;
      if r.cashed_out_stake > 0 then raise exception 'VALIDATION: bet has partial cash-outs; financial fields are locked'; end if;
      if r.kind = 'accumulator' and p ? 'legs' then
        delete from bet_legs where bet_id = r.id;
        v_odds := 1;
        for v_leg in select * from jsonb_array_elements(p->'legs') loop
          v_i := v_i + 1;
          insert into bet_legs (bet_id, leg_no, sport_id, event_name, market, selection, line, odds, status)
          values (r.id, v_i, r.sport_id, coalesce(v_leg->>'event_name', 'Leg ' || v_i), coalesce(v_leg->>'market', 'Match Winner'),
                  coalesce(v_leg->>'selection','?'), nullif(v_leg->>'line','')::numeric, (v_leg->>'odds')::numeric, 'pending');
          v_odds := v_odds * (v_leg->>'odds')::numeric;
        end loop;
        v_odds := round(v_odds, 4);
      end if;
      b := private.lock_bankroll(v_bankroll, p_user);
      if b.is_demo <> r.is_demo then raise exception 'VALIDATION: cannot move a bet between demo and live'; end if;
      v_fx := case when v_ccy = b.currency then 1
                   when nullif(p->>'fx_rate','') is not null then (p->>'fx_rate')::numeric
                   when v_ccy = r.currency and v_bankroll = r.bankroll_id then r.fx_rate
                   else private.fx_rate(v_ccy, b.currency, r.placed_at::date, p_user) end;
      v_old_res := round(r.liability * r.fx_rate, 2);
      v_new_res := round(private.bet_liability(v_side, v_odds, v_stake) * v_fx, 2);
      perform private.post_tx(p_user, r.bankroll_id, 'bet_reversal', v_old_res, r.id, null, 'Reservation released (bet edited)', now());
      perform private.check_risk_limits(p_user, b, v_new_res, r.event_id, coalesce(p->>'event_name', r.event_name), r.id);
      perform private.post_tx(p_user, v_bankroll, 'bet_placement', -v_new_res, r.id, null, 'Reservation (bet edited)', now());
      update bets set side = v_side, odds = v_odds, stake = v_stake, commission = v_comm, bankroll_id = v_bankroll,
                      currency = v_ccy, fx_rate = v_fx, liability = private.bet_liability(v_side, v_odds, v_stake),
                      potential_payout = private.bet_potential_payout(v_side, v_odds, v_stake, v_comm)
       where id = r.id;
    end if;
  end if;

  update bets set
    placed_at        = coalesce(nullif(p->>'placed_at','')::timestamptz, placed_at),
    sport_id         = case when p ? 'sport_id' or p ? 'sport_key' then private.resolve_sport(p, p_user) else sport_id end,
    league_id        = case when p ? 'league_id' or p ? 'league_name' then private.resolve_league(p, p_user, coalesce(case when p ? 'sport_id' or p ? 'sport_key' then private.resolve_sport(p, p_user) end, sport_id)) else league_id end,
    event_name       = coalesce(nullif(trim(p->>'event_name'),''), event_name),
    home             = case when p ? 'home' then nullif(trim(p->>'home'),'') else home end,
    away             = case when p ? 'away' then nullif(trim(p->>'away'),'') else away end,
    event_start      = case when p ? 'event_start' then nullif(p->>'event_start','')::timestamptz else event_start end,
    is_live          = coalesce((p->>'is_live')::boolean, is_live),
    market_type_id   = case when p ? 'market_type_id' then nullif(p->>'market_type_id','')::uuid else market_type_id end,
    market_category  = case when p ? 'market_category' then nullif(p->>'market_category','') else market_category end,
    market           = coalesce(nullif(trim(p->>'market'),''), market),
    selection        = coalesce(nullif(trim(p->>'selection'),''), selection),
    line             = case when p ? 'line' then nullif(p->>'line','')::numeric else line end,
    bookmaker_id     = case when p ? 'bookmaker_id' or p ? 'bookmaker_key' then private.resolve_bookmaker(p, p_user) else bookmaker_id end,
    est_probability  = case when p ? 'est_probability' then nullif(p->>'est_probability','')::numeric else est_probability end,
    opening_odds     = case when p ? 'opening_odds' then nullif(p->>'opening_odds','')::numeric else opening_odds end,
    closing_odds     = case when p ? 'closing_odds' then nullif(p->>'closing_odds','')::numeric else closing_odds end,
    closing_source   = case when p ? 'closing_odds' then case when nullif(p->>'closing_odds','') is null then null else 'manual' end else closing_source end,
    closing_captured_at = case when p ? 'closing_odds' then now() else closing_captured_at end,
    strategy_id      = case when p ? 'strategy_id' or p ? 'strategy_name' then private.resolve_strategy(p, p_user, r.is_demo) else strategy_id end,
    confidence       = case when p ? 'confidence' then nullif(p->>'confidence','')::smallint else confidence end,
    units            = case when p ? 'units' then nullif(p->>'units','')::numeric else units end,
    tags             = case when p ? 'tags' then coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}') else tags end,
    notes            = case when p ? 'notes' then nullif(p->>'notes','') else notes end,
    correlation_group = case when p ? 'correlation_group' then nullif(trim(p->>'correlation_group'),'') else correlation_group end,
    updated_at       = now()
  where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.reset_demo_data(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := private.require_user();
  x jsonb; y jsonb; b bankrolls; v_bank jsonb := '{}'::jsonb; v_ev uuid; v_mk uuid; v_bets int := 0; v_trades int := 0;
  v_book uuid; t trades; v_tx jsonb; v_mkmap jsonb := '{}'::jsonb;
begin
  perform private.purge_demo(v_user);
  insert into risk_limits (user_id, is_demo) values (v_user, true) on conflict do nothing;

  for x in select * from jsonb_array_elements(coalesce(p->'bankrolls','[]')) loop
    insert into bankrolls (user_id, is_demo, name, kind, currency, sport_id)
    values (v_user, true, x->>'name', coalesce(x->>'kind','custom'), x->>'currency',
            case when x ? 'sport_key' then private.resolve_sport(x, v_user) end)
    returning * into b;
    v_bank := v_bank || jsonb_build_object(x->>'name', b.id);
    for v_tx in select * from jsonb_array_elements(coalesce(x->'transactions','[]')) loop
      perform private.post_tx(v_user, b.id, (v_tx->>'type')::tx_type, (v_tx->>'amount')::numeric, null, null,
                              v_tx->>'note', (v_tx->>'occurred_at')::timestamptz);
    end loop;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'strategies','[]')) loop
    insert into strategies (user_id, is_demo, name, description, sport_id, entry_conditions, min_odds, max_odds, est_probability, stake_rule, color)
    values (v_user, true, x->>'name', x->>'description', case when x ? 'sport_key' then private.resolve_sport(x, v_user) end,
            x->>'entry_conditions', nullif(x->>'min_odds','')::numeric, nullif(x->>'max_odds','')::numeric,
            nullif(x->>'est_probability','')::numeric, coalesce(x->'stake_rule', '{"type":"flat","value":1}'), coalesce(x->>'color', '#3b82f6'));
  end loop;

  -- Demo events, markets and simulated odds history (for the odds monitor & CLV capture).
  for x in select * from jsonb_array_elements(coalesce(p->'events','[]')) loop
    insert into events (owner_id, is_demo, sport_id, league_id, name, home, away, start_time, status, provider, external_id)
    values (v_user, true, private.resolve_sport(x, v_user), private.resolve_league(x, v_user, private.resolve_sport(x, v_user)), x->>'name', x->>'home', x->>'away', (x->>'start_time')::timestamptz,
            coalesce(x->>'status','scheduled')::event_status, 'demo', x->>'ref')
    returning id into v_ev;
    for y in select * from jsonb_array_elements(coalesce(x->'markets','[]')) loop
      insert into markets (event_id, key, name, line) values (v_ev, y->>'key', y->>'name', nullif(y->>'line','')::numeric) returning id into v_mk;
      v_mkmap := v_mkmap || jsonb_build_object((x->>'ref') || ':' || (y->>'key'), jsonb_build_object('event', v_ev, 'market', v_mk));
      insert into odds_snapshots (owner_id, is_demo, event_id, market_id, bookmaker_id, selection, line, odds, is_live, suspended, provider, captured_at)
      select v_user, true, v_ev, v_mk, bk.id, s->>'selection', nullif(y->>'line','')::numeric, (s->>'odds')::numeric,
             coalesce((s->>'is_live')::boolean, false), coalesce((s->>'suspended')::boolean, false), 'demo', (s->>'at')::timestamptz
        from jsonb_array_elements(coalesce(y->'snapshots','[]')) s
        join bookmakers bk on bk.key = s->>'bookmaker' and bk.owner_id is null;
    end loop;
  end loop;
  update odds_snapshots o set is_closing = true from (
    select distinct on (s.market_id, s.bookmaker_id, s.selection) s.id
      from odds_snapshots s join events e on e.id = s.event_id
     where e.owner_id = v_user and e.is_demo and e.start_time <= now() and s.captured_at <= e.start_time
     order by s.market_id, s.bookmaker_id, s.selection, s.captured_at desc) c
  where o.id = c.id;

  for x in select * from jsonb_array_elements(coalesce(p->'bets','[]')) loop
    if x ? 'market_ref' and v_mkmap ? (x->>'market_ref') then
      x := x || jsonb_build_object('event_id', v_mkmap->(x->>'market_ref')->>'event', 'market_id', v_mkmap->(x->>'market_ref')->>'market');
    end if;
    perform private.place_bet(v_user, x || jsonb_build_object('bankroll_id', v_bank->>(x->>'bankroll')));
    v_bets := v_bets + 1;
  end loop;

  -- Trades go through the same reservation-accounting functions as live trades.
  for x in select * from jsonb_array_elements(coalesce(p->'trades','[]')) loop
    v_book := private.resolve_bookmaker(x, v_user);
    insert into trades (user_id, is_demo, bankroll_id, sport_id, league_id, event_name, market, selection, bookmaker_id, currency, commission, is_live, opened_at, notes)
    values (v_user, true, (v_bank->>(x->>'bankroll'))::uuid, private.resolve_sport(x, v_user),
            private.resolve_league(x, v_user, private.resolve_sport(x, v_user)), x->>'event_name', x->>'market', x->>'selection',
            v_book, x->>'currency', coalesce((x->>'commission')::numeric, 0), true, (x->>'opened_at')::timestamptz, x->>'notes')
    returning * into t;
    for y in select * from jsonb_array_elements(x->'executions') loop
      perform private.add_trade_execution(v_user, t.id, (y->>'side')::execution_side, nullif(y->>'odds','')::numeric, (y->>'stake')::numeric,
                                          nullif(y->>'amount','')::numeric, (y->>'executed_at')::timestamptz, null);
    end loop;
    if x ? 'outcome' then
      perform private.settle_trade(v_user, t.id, (x->>'outcome')::trade_outcome, (x->>'closed_at')::timestamptz);
    end if;
    v_trades := v_trades + 1;
  end loop;

  perform private.refresh_performance_snapshots(v_user);
  update user_settings set mode = 'demo', updated_at = now() where user_id = v_user;
  insert into alerts (user_id, is_demo, type, severity, title, body)
  values (v_user, true, 'system', 'info', 'Demo workspace loaded',
          format('%s simulated bets and %s trades. Demo data is isolated from your live records.', v_bets, v_trades));
  return jsonb_build_object('bets', v_bets, 'trades', v_trades);
end $$;
-- ── Backfill: reserve exposure for trades that were opened before this migration ─
do $$
declare t record;
begin
  for t in select id, user_id from trades where status = 'open' and reserved_base = 0 loop
    begin
      perform private.trade_sync_reservation(t.user_id, t.id, now(), 'Exposure reserved (accounting migration)');
    exception when others then
      raise notice 'trade % not backfilled: %', t.id, sqlerrm;
    end;
  end loop;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to service_role;
revoke execute on function public.queue_test_email(), public.set_leg_results(uuid, jsonb) from public, anon;
grant execute on function public.queue_test_email(), public.set_leg_results(uuid, jsonb) to authenticated;
grant all on email_outbox, email_events to service_role;
