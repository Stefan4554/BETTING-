-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0003 financial engine (authoritative settlement & ledger)
--
-- Everything that moves money runs here, inside one database transaction per call, with
-- row locks on the bet / bankroll being changed. The TypeScript engine in
-- src/lib/finance mirrors these formulas for previews and analytics; tests assert parity.
--
-- private.*  internal helpers, not exposed through the API.
-- public.*   RPCs callable by signed-in users (SECURITY DEFINER, ownership checked
--            explicitly against auth.uid()).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

-- ── Pure maths ───────────────────────────────────────────────────────────────

-- Return multiplier of one selection for a result.
--   won → odds · half_won → (1+odds)/2 · void → 1 · half_lost → 0.5 · lost → 0
create or replace function private.leg_factor(p_status text, p_odds numeric)
returns numeric language sql immutable strict as $$
  select case p_status
    when 'won'       then p_odds
    when 'half_won'  then (1 + p_odds) / 2
    when 'void'      then 1::numeric
    when 'half_lost' then 0.5
    when 'lost'      then 0::numeric
    else null end;
$$;

-- Profit of a bet in bet currency, rounded to cents (half away from zero).
--   back : open stake × (F − 1), commission charged on positive winnings only,
--          plus realised cash-out P/L (cashout_amount − cashed_out_stake).
--   lay  : won → stake·(1−c); half_won → stake/2·(1−c); lost → −liability; half_lost → −liability/2.
-- p_factor overrides F (accumulators: product of leg factors).
create or replace function private.bet_profit(
  p_side bet_side, p_odds numeric, p_stake numeric, p_commission numeric, p_status bet_status,
  p_cashed_out_stake numeric default 0, p_cashout_amount numeric default 0, p_factor numeric default null
) returns numeric language plpgsql immutable as $$
declare
  v_open numeric := p_stake - coalesce(p_cashed_out_stake, 0);
  v_f numeric;
  v_gross numeric;
  v_liab numeric := round(p_stake * (p_odds - 1), 2);
begin
  if p_status = 'pending' then return null; end if;
  if p_side = 'lay' then
    return case p_status
      when 'won'       then round(p_stake * (1 - p_commission), 2)
      when 'half_won'  then round(p_stake / 2 * (1 - p_commission), 2)
      when 'lost'      then -v_liab
      when 'half_lost' then -round(v_liab / 2, 2)
      when 'void'      then 0
      else null end;
  end if;
  if p_status = 'cashed_out' then
    return round(coalesce(p_cashout_amount, 0) - p_stake, 2);
  end if;
  v_f := coalesce(p_factor, private.leg_factor(p_status::text, p_odds));
  v_gross := v_open * (v_f - 1);
  if v_gross > 0 then v_gross := v_gross * (1 - p_commission); end if;
  return round(v_gross, 2) + round(coalesce(p_cashout_amount, 0) - coalesce(p_cashed_out_stake, 0), 2);
end $$;

create or replace function private.bet_liability(p_side bet_side, p_odds numeric, p_stake numeric)
returns numeric language sql immutable as $$
  select case when p_side = 'lay' then round(p_stake * (p_odds - 1), 2) else p_stake end;
$$;

create or replace function private.bet_potential_payout(p_side bet_side, p_odds numeric, p_stake numeric, p_commission numeric)
returns numeric language sql immutable as $$
  select case when p_side = 'lay'
    then round(p_stake * (p_odds - 1), 2) + round(p_stake * (1 - p_commission), 2)
    else p_stake + round(p_stake * (p_odds - 1) * (1 - p_commission), 2) end;
$$;

-- Duplicate-detection fingerprint for imports.
create or replace function private.bet_fingerprint(p_placed timestamptz, p_event text, p_market text, p_selection text, p_odds numeric, p_stake numeric, p_bookmaker uuid)
returns text language sql immutable as $$
  select md5(concat_ws('|', to_char(p_placed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), lower(trim(p_event)), lower(trim(p_market)),
                       lower(trim(p_selection)), round(p_odds, 4)::text, round(p_stake, 2)::text, coalesce(p_bookmaker::text, '')));
$$;

-- ── Context helpers ──────────────────────────────────────────────────────────

create or replace function private.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'AUTH_REQUIRED: sign in first' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function private.user_is_demo(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select mode = 'demo' from user_settings where user_id = p_user), false);
$$;

create or replace function private.lock_bankroll(p_bankroll uuid, p_user uuid) returns bankrolls
language plpgsql as $$
declare b bankrolls;
begin
  select * into b from bankrolls where id = p_bankroll for update;
  if not found or b.user_id <> p_user then raise exception 'NOT_FOUND: bankroll % not found', p_bankroll using errcode = 'P0002'; end if;
  return b;
end $$;

-- Rate to convert 1 unit of p_from into p_to on p_date (latest snapshot on or before the date).
-- Uses the user's own rates first, then the platform feed; inverse pairs are used if needed.
create or replace function private.fx_rate(p_from char(3), p_to char(3), p_date date, p_user uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare r numeric;
begin
  if p_from = p_to then return 1; end if;
  select x.rate into r from (
    select rate, as_of, (owner_id is not null) as own from exchange_rates
     where base = p_from and quote = p_to and as_of <= p_date and (owner_id is null or owner_id = p_user)
    union all
    select 1 / rate, as_of, (owner_id is not null) from exchange_rates
     where base = p_to and quote = p_from and as_of <= p_date and (owner_id is null or owner_id = p_user)
  ) x order by x.as_of desc, x.own desc limit 1;
  if r is null then
    raise exception 'FX_MISSING: no exchange rate %/% on or before %; add one in Settings → Currencies or pass fx_rate', p_from, p_to, p_date
      using errcode = 'P0001';
  end if;
  return round(r, 8);
end $$;

-- ── Ledger posting ───────────────────────────────────────────────────────────

-- The only writer of bankroll_transactions. Locks the bankroll row, enforces the
-- no-overdraft rule for debits and maintains the balance cache.
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
     and p_type in ('withdrawal','bet_placement','transfer_out') then
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

-- ── Lookups by key (used by import & demo loader) ───────────────────────────

create or replace function private.resolve_sport(p jsonb, p_user uuid) returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  if p ? 'sport_id' and nullif(p->>'sport_id','') is not null then
    select id into v from sports where id = (p->>'sport_id')::uuid and (owner_id is null or owner_id = p_user);
  elsif p ? 'sport_key' then
    select id into v from sports where key = lower(p->>'sport_key') and (owner_id is null or owner_id = p_user)
     order by owner_id nulls last limit 1;
    if v is null then
      select id into v from sports where lower(name) = lower(p->>'sport_key') and (owner_id is null or owner_id = p_user)
       order by owner_id nulls last limit 1;
    end if;
  end if;
  if v is null then
    select id into v from sports where key = 'other' and owner_id is null;
  end if;
  return v;
end $$;

create or replace function private.resolve_bookmaker(p jsonb, p_user uuid) returns uuid
language plpgsql as $$
declare v uuid; k text;
begin
  if nullif(p->>'bookmaker_id','') is not null then
    select id into v from bookmakers where id = (p->>'bookmaker_id')::uuid and (owner_id is null or owner_id = p_user);
    return v;
  end if;
  k := nullif(trim(coalesce(p->>'bookmaker_key', p->>'bookmaker')), '');
  if k is null then return null; end if;
  select id into v from bookmakers
   where (key = lower(regexp_replace(k, '[^a-zA-Z0-9]+', '_', 'g')) or lower(name) = lower(k))
     and (owner_id is null or owner_id = p_user)
   order by owner_id nulls last limit 1;
  if v is null then   -- unknown bookmaker on import: create a private one
    insert into bookmakers (owner_id, key, name)
    values (p_user, left(trim(both '_' from lower(regexp_replace(k, '[^a-zA-Z0-9]+', '_', 'g'))), 60), left(k, 80))
    on conflict do nothing returning id into v;
    if v is null then
      select id into v from bookmakers where owner_id = p_user and key = left(trim(both '_' from lower(regexp_replace(k, '[^a-zA-Z0-9]+', '_', 'g'))), 60);
    end if;
  end if;
  return v;
end $$;

create or replace function private.resolve_strategy(p jsonb, p_user uuid, p_demo boolean) returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  if nullif(p->>'strategy_id','') is not null then
    select id into v from strategies where id = (p->>'strategy_id')::uuid and user_id = p_user;
  elsif nullif(p->>'strategy_name','') is not null then
    select id into v from strategies where lower(name) = lower(p->>'strategy_name') and user_id = p_user and is_demo = p_demo;
  end if;
  return v;
end $$;

-- ── Risk limits (hard enforcement when risk_limits.enforce) ─────────────────

create or replace function private.check_risk_limits(p_user uuid, b bankrolls, p_reservation numeric, p_event_id uuid, p_event_name text, p_exclude_bet uuid)
returns void language plpgsql as $$
declare
  rl risk_limits;
  v_open numeric;
  v_event numeric;
  v_equity numeric;
begin
  select * into rl from risk_limits where user_id = p_user and is_demo = b.is_demo;
  if not found or not rl.enforce then return; end if;
  select coalesce(sum(round(liability * fx_rate, 2)), 0) into v_open
    from bets where bankroll_id = b.id and status = 'pending' and deleted_at is null and id is distinct from p_exclude_bet;
  v_equity := b.balance + v_open;
  if rl.max_stake_per_bet is not null and p_reservation > rl.max_stake_per_bet then
    raise exception 'RISK_LIMIT: stake % exceeds max stake per bet %', p_reservation, rl.max_stake_per_bet;
  end if;
  if rl.max_bet_pct_bankroll is not null and v_equity > 0 and p_reservation > v_equity * rl.max_bet_pct_bankroll then
    raise exception 'RISK_LIMIT: stake % exceeds %%% of bankroll (% max)', p_reservation, round(rl.max_bet_pct_bankroll * 100, 2), round(v_equity * rl.max_bet_pct_bankroll, 2);
  end if;
  if rl.max_total_exposure_pct is not null and v_equity > 0 and v_open + p_reservation > v_equity * rl.max_total_exposure_pct then
    raise exception 'RISK_LIMIT: open exposure would be % (max %)', v_open + p_reservation, round(v_equity * rl.max_total_exposure_pct, 2);
  end if;
  if rl.max_event_exposure is not null then
    select coalesce(sum(round(liability * fx_rate, 2)), 0) into v_event from bets
     where user_id = p_user and is_demo = b.is_demo and status = 'pending' and deleted_at is null and id is distinct from p_exclude_bet
       and ((p_event_id is not null and event_id = p_event_id) or lower(event_name) = lower(p_event_name));
    if v_event + p_reservation > rl.max_event_exposure then
      raise exception 'RISK_LIMIT: exposure on "%" would be % (max %)', p_event_name, v_event + p_reservation, rl.max_event_exposure;
    end if;
  end if;
end $$;

-- ── Bet lifecycle ────────────────────────────────────────────────────────────

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
    nullif(p->>'league_id','')::uuid, nullif(p->>'event_id','')::uuid, nullif(p->>'market_id','')::uuid,
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
           count(*) filter (where status <> 'void')
      into v_pending, v_lost, v_nonvoid from bet_legs where bet_id = r.id;
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
    v_status := case when v_lost > 0 then 'lost' when v_nonvoid = 0 then 'void' else 'won' end;
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
    select coalesce((alert_preferences->>'large_result')::numeric, 0) into v_threshold from user_settings where user_id = p_user;
    if v_threshold > 0 and abs(v_profit * r.fx_rate) >= v_threshold then
      insert into alerts (user_id, is_demo, type, severity, title, body, data, dedupe_key)
      values (p_user, r.is_demo, 'large_result', case when v_profit < 0 then 'warning' else 'info' end,
              case when v_profit < 0 then 'Large loss' else 'Large win' end,
              format('Bet #%s %s — %s: %s %s', r.ref, r.event_name, r.selection, to_char(v_profit, 'FMS999G999G990D00'), r.currency),
              jsonb_build_object('bet_id', r.id, 'profit', v_profit), 'large_result:' || r.id || ':' || r.settle_count)
      on conflict do nothing;
    end if;
  end if;
  return r;
end $$;

create or replace function private.partial_cashout(p_user uuid, p_bet uuid, p_stake_portion numeric, p_amount numeric, p_at timestamptz default now())
returns bets language plpgsql as $$
declare r bets; v_portion numeric := round(p_stake_portion, 2); v_amount numeric := round(p_amount, 2);
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> p_user or r.deleted_at is not null then raise exception 'NOT_FOUND: bet not found'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_SETTLED: bet #% is settled', r.ref; end if;
  if r.side = 'lay' then raise exception 'VALIDATION: lay bets cannot be cashed out'; end if;
  if v_portion is null or v_portion <= 0 or v_amount is null or v_amount < 0 then
    raise exception 'VALIDATION: stake portion must be > 0 and amount >= 0';
  end if;
  if v_portion >= r.stake - r.cashed_out_stake then
    raise exception 'VALIDATION: partial cash-out must be less than the open stake (%); use a full cash-out instead', r.stake - r.cashed_out_stake;
  end if;
  update bets set cashed_out_stake = cashed_out_stake + v_portion, cashout_amount = cashout_amount + v_amount, updated_at = now()
   where id = r.id returning * into r;
  if v_amount > 0 then
    perform private.post_tx(p_user, r.bankroll_id, 'cashout', round(v_amount * r.fx_rate, 2), r.id, null,
                            format('Partial cash-out of %s stake', v_portion), coalesce(p_at, now()), null, null,
                            case when r.fx_rate <> 1 then r.fx_rate end, case when r.fx_rate <> 1 then v_amount end,
                            case when r.fx_rate <> 1 then r.currency end);
  end if;
  return r;
end $$;

-- Reverse the latest settlement and return the bet to pending.
create or replace function private.reopen_bet(p_user uuid, p_bet uuid) returns bets
language plpgsql as $$
declare r bets; t bankroll_transactions;
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> p_user or r.deleted_at is not null then raise exception 'NOT_FOUND: bet not found'; end if;
  if r.status = 'pending' then raise exception 'VALIDATION: bet #% is not settled', r.ref; end if;
  select * into t from bankroll_transactions where bet_id = r.id and type = 'bet_settlement' and settlement_seq = r.settle_count;
  if t.id is not null and t.amount <> 0 then
    perform private.post_tx(p_user, r.bankroll_id, 'bet_reversal', -t.amount, r.id, null, 'Settlement reversed (reopened)', now());
  end if;
  update bets set status = 'pending', profit = null, actual_payout = null, settled_at = null,
                  cashout_amount = cashout_amount - settled_cashout_amount, cashed_out_stake = cashed_out_stake - settled_cashout_stake,
                  settled_cashout_amount = 0, settled_cashout_stake = 0, updated_at = now()
   where id = r.id returning * into r;
  if r.kind = 'accumulator' then update bet_legs set status = 'pending' where bet_id = r.id; end if;
  return r;
end $$;

-- Edit a bet. Descriptive & analytics fields are always editable. Financial fields
-- (stake, odds, side, commission, bankroll, currency, fx, legs) only while pending and
-- before any cash-out: the old reservation is released and a new one posted.
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
    league_id        = case when p ? 'league_id' then nullif(p->>'league_id','')::uuid else league_id end,
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

-- Soft delete: the bet stays in the database (audit trail) and its net ledger effect is reversed.
create or replace function private.delete_bet(p_user uuid, p_bet uuid) returns void
language plpgsql as $$
declare r bets; x record;
begin
  select * into r from bets where id = p_bet for update;
  if not found or r.user_id <> p_user or r.deleted_at is not null then raise exception 'NOT_FOUND: bet not found'; end if;
  for x in select bankroll_id, sum(amount) as net from bankroll_transactions where bet_id = r.id group by bankroll_id loop
    if x.net <> 0 then
      perform private.post_tx(p_user, x.bankroll_id, 'bet_reversal', -x.net, r.id, null, 'Bet deleted', now());
    end if;
  end loop;
  update bets set deleted_at = now(), updated_at = now() where id = r.id;
end $$;

-- ── Public bet RPCs ──────────────────────────────────────────────────────────

create or replace function public.place_bet(p jsonb) returns bets
language plpgsql security definer set search_path = public as $$
begin return private.place_bet(private.require_user(), p); end $$;

create or replace function public.settle_bet(p_bet uuid, p_status bet_status default null, p_legs jsonb default null,
  p_closing_odds numeric default null, p_settled_at timestamptz default null, p_cashout_amount numeric default null)
returns bets language plpgsql security definer set search_path = public as $$
begin return private.settle_bet(private.require_user(), p_bet, p_status, p_legs, p_closing_odds, coalesce(p_settled_at, now()), p_cashout_amount, true); end $$;

-- All-or-nothing: if any bet cannot be settled the whole batch is rolled back.
create or replace function public.bulk_settle(p_bets uuid[], p_status bet_status) returns int
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); v_id uuid; n int := 0;
begin
  if p_status in ('pending','cashed_out') then raise exception 'VALIDATION: bulk settle supports won/lost/void/half results only'; end if;
  foreach v_id in array p_bets loop
    if (select kind from bets where id = v_id) = 'accumulator' then
      raise exception 'VALIDATION: accumulators must be settled leg by leg';
    end if;
    perform private.settle_bet(v_user, v_id, p_status, null, null, now(), null, true);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.reopen_bet(p_bet uuid) returns bets
language plpgsql security definer set search_path = public as $$
begin return private.reopen_bet(private.require_user(), p_bet); end $$;

create or replace function public.update_bet(p_bet uuid, p jsonb) returns bets
language plpgsql security definer set search_path = public as $$
begin return private.update_bet(private.require_user(), p_bet, p); end $$;

create or replace function public.bulk_update_bets(p_bets uuid[], p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); v_id uuid; n int := 0;
begin
  if p ?| array['stake','odds','side','commission','bankroll_id','currency','fx_rate','legs'] then
    raise exception 'VALIDATION: bulk edit cannot change financial fields';
  end if;
  foreach v_id in array p_bets loop perform private.update_bet(v_user, v_id, p); n := n + 1; end loop;
  return n;
end $$;

create or replace function public.delete_bet(p_bet uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform private.delete_bet(private.require_user(), p_bet); end $$;

create or replace function public.partial_cashout(p_bet uuid, p_stake_portion numeric, p_amount numeric) returns bets
language plpgsql security definer set search_path = public as $$
begin return private.partial_cashout(private.require_user(), p_bet, p_stake_portion, p_amount, now()); end $$;

create or replace function public.add_bet_note(p_bet uuid, p_body text) returns bet_notes
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); n bet_notes;
begin
  if not exists (select 1 from bets where id = p_bet and user_id = v_user) then raise exception 'NOT_FOUND: bet not found'; end if;
  insert into bet_notes (bet_id, user_id, body) values (p_bet, v_user, p_body) returning * into n;
  return n;
end $$;

-- Bulk import. Each row is applied in its own sub-transaction so one bad row does not
-- abort the batch; failures are reported per row.
create or replace function public.import_bets(p_bankroll uuid, p_rows jsonb, p_skip_duplicates boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := private.require_user();
  v_row jsonb; v_i int := 0; v_ok int := 0; v_dup int := 0; v_err jsonb := '[]'::jsonb;
begin
  perform private.lock_bankroll(p_bankroll, v_user);
  if jsonb_array_length(p_rows) > 5000 then raise exception 'VALIDATION: max 5000 rows per import batch'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      perform private.place_bet(v_user, v_row || jsonb_build_object('bankroll_id', p_bankroll, 'check_duplicate', p_skip_duplicates));
      v_ok := v_ok + 1;
    exception
      when unique_violation then v_dup := v_dup + 1;
      when others then v_err := v_err || jsonb_build_object('row', coalesce((v_row->>'_row')::int, v_i), 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', v_ok, 'duplicates', v_dup, 'errors', v_err);
end $$;

-- ── Bankroll RPCs ────────────────────────────────────────────────────────────

create or replace function public.create_bankroll(p_name text, p_currency char(3), p_kind text default 'custom',
  p_sport uuid default null, p_opening_deposit numeric default 0, p_allow_negative boolean default false)
returns bankrolls language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); b bankrolls;
begin
  insert into bankrolls (user_id, is_demo, name, kind, sport_id, currency, allow_negative)
  values (v_user, private.user_is_demo(v_user), trim(p_name), p_kind, p_sport, upper(p_currency), p_allow_negative)
  returning * into b;
  if coalesce(p_opening_deposit, 0) > 0 then
    perform private.post_tx(v_user, b.id, 'deposit', p_opening_deposit, null, null, 'Opening balance', now());
    select * into b from bankrolls where id = b.id;
  end if;
  return b;
end $$;

-- Capital flows. These never count as betting profit.
create or replace function public.record_transaction(p_bankroll uuid, p_type tx_type, p_amount numeric,
  p_note text default null, p_occurred_at timestamptz default null)
returns bankroll_transactions language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); v_amount numeric := round(p_amount, 2);
begin
  if p_type not in ('deposit','withdrawal','adjustment') then
    raise exception 'VALIDATION: only deposit, withdrawal and adjustment can be recorded directly';
  end if;
  if v_amount is null or v_amount = 0 then raise exception 'VALIDATION: amount must be non-zero'; end if;
  if p_type in ('deposit','withdrawal') and v_amount < 0 then raise exception 'VALIDATION: amount must be positive'; end if;
  if p_type = 'adjustment' and nullif(trim(p_note), '') is null then raise exception 'VALIDATION: adjustments require a note'; end if;
  return private.post_tx(v_user, p_bankroll, p_type, case when p_type = 'withdrawal' then -v_amount else v_amount end,
                         null, null, p_note, coalesce(p_occurred_at, now()));
end $$;

create or replace function public.transfer_funds(p_from uuid, p_to uuid, p_amount numeric, p_fx_rate numeric default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); a bankrolls; b bankrolls; g uuid := gen_random_uuid(); v_fx numeric; v_amt numeric := round(p_amount, 2);
begin
  if p_from = p_to then raise exception 'VALIDATION: choose two different bankrolls'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'VALIDATION: amount must be positive'; end if;
  -- lock in a stable order to avoid deadlocks
  if p_from < p_to then a := private.lock_bankroll(p_from, v_user); b := private.lock_bankroll(p_to, v_user);
  else b := private.lock_bankroll(p_to, v_user); a := private.lock_bankroll(p_from, v_user); end if;
  if a.is_demo <> b.is_demo then raise exception 'VALIDATION: cannot transfer between demo and live bankrolls'; end if;
  v_fx := case when a.currency = b.currency then 1 else coalesce(p_fx_rate, private.fx_rate(a.currency, b.currency, current_date, v_user)) end;
  perform private.post_tx(v_user, a.id, 'transfer_out', -v_amt, null, null, coalesce(p_note, 'Transfer to ' || b.name), now(), null, g);
  perform private.post_tx(v_user, b.id, 'transfer_in', round(v_amt * v_fx, 2), null, null, coalesce(p_note, 'Transfer from ' || a.name), now(), null, g,
                          case when v_fx <> 1 then v_fx end, case when v_fx <> 1 then v_amt end, case when v_fx <> 1 then a.currency end);
  return g;
end $$;

-- Rebuild the balance cache from the ledger (integrity check). Returns the difference fixed.
create or replace function public.verify_bankroll(p_bankroll uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); b bankrolls; v_sum numeric;
begin
  b := private.lock_bankroll(p_bankroll, v_user);
  select coalesce(sum(amount), 0) into v_sum from bankroll_transactions where bankroll_id = b.id;
  return jsonb_build_object('cached', b.balance, 'ledger', v_sum, 'consistent', b.balance = v_sum);
end $$;

-- ── Trading ──────────────────────────────────────────────────────────────────

-- P/L of a trade for an outcome, before commission.
--   win  = Σback s(o−1) × (1 − closed share) − Σlay s(o−1) + (Σcash − Σcashed stake)
--   lose = −(Σback s − Σcashed stake) + Σlay s + (Σcash − Σcashed stake)
create or replace function private.trade_pnl(p_trade uuid, p_outcome trade_outcome) returns numeric
language plpgsql stable as $$
declare bs numeric; bw numeric; lw numeric; ls numeric; cs numeric; ca numeric; v numeric;
begin
  select coalesce(sum(stake) filter (where side = 'back'), 0),
         coalesce(sum(stake * (odds - 1)) filter (where side = 'back'), 0),
         coalesce(sum(stake * (odds - 1)) filter (where side = 'lay'), 0),
         coalesce(sum(stake) filter (where side = 'lay'), 0),
         coalesce(sum(stake) filter (where side = 'cashout'), 0),
         coalesce(sum(amount) filter (where side = 'cashout'), 0)
    into bs, bw, lw, ls, cs, ca from trade_executions where trade_id = p_trade;
  if p_outcome = 'void' then return round(ca - cs, 2); end if;
  if p_outcome = 'win' then
    v := (case when bs > 0 then bw * (1 - cs / bs) else 0 end) - lw + (ca - cs);
  else
    v := -(bs - cs) + ls + (ca - cs);
  end if;
  return v;
end $$;

create or replace function public.open_trade(p jsonb) returns trades
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); b bankrolls; t trades; v_ccy char(3); v_ex jsonb;
begin
  b := private.lock_bankroll((p->>'bankroll_id')::uuid, v_user);
  v_ccy := upper(coalesce(nullif(p->>'currency',''), b.currency));
  insert into trades (user_id, is_demo, bankroll_id, sport_id, event_id, event_name, market, selection, bookmaker_id, currency, fx_rate,
                      commission, is_live, strategy_id, notes, opened_at)
  values (v_user, b.is_demo, b.id, private.resolve_sport(p, v_user), nullif(p->>'event_id','')::uuid, trim(p->>'event_name'),
          coalesce(nullif(p->>'market',''), 'Match Odds'), trim(p->>'selection'), private.resolve_bookmaker(p, v_user), v_ccy,
          case when v_ccy = b.currency then 1 else coalesce(nullif(p->>'fx_rate','')::numeric, private.fx_rate(v_ccy, b.currency, current_date, v_user)) end,
          coalesce(nullif(p->>'commission','')::numeric, 0), coalesce((p->>'is_live')::boolean, true),
          private.resolve_strategy(p, v_user, b.is_demo), nullif(p->>'notes',''), coalesce(nullif(p->>'opened_at','')::timestamptz, now()))
  returning * into t;
  for v_ex in select * from jsonb_array_elements(coalesce(p->'executions', '[]'::jsonb)) loop
    perform public.add_trade_execution(t.id, (v_ex->>'side')::execution_side, nullif(v_ex->>'odds','')::numeric,
                                       (v_ex->>'stake')::numeric, nullif(v_ex->>'amount','')::numeric,
                                       nullif(v_ex->>'executed_at','')::timestamptz, v_ex->>'note');
  end loop;
  return t;
end $$;

create or replace function public.add_trade_execution(p_trade uuid, p_side execution_side, p_odds numeric, p_stake numeric,
  p_amount numeric default null, p_executed_at timestamptz default null, p_note text default null)
returns trade_executions language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); t trades; e trade_executions; v_back numeric; v_cashed numeric;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.user_id <> v_user then raise exception 'NOT_FOUND: trade not found'; end if;
  if t.status <> 'open' then raise exception 'VALIDATION: trade is closed'; end if;
  if p_side = 'cashout' then
    select coalesce(sum(stake) filter (where side = 'back'), 0), coalesce(sum(stake) filter (where side = 'cashout'), 0)
      into v_back, v_cashed from trade_executions where trade_id = t.id;
    if p_stake > v_back - v_cashed then
      raise exception 'VALIDATION: cash-out stake % exceeds open back stake %', p_stake, v_back - v_cashed;
    end if;
  end if;
  insert into trade_executions (trade_id, side, odds, stake, amount, executed_at, note)
  values (t.id, p_side, case when p_side = 'cashout' then null else p_odds end, round(p_stake, 2),
          case when p_side = 'cashout' then round(coalesce(p_amount, 0), 2) end, coalesce(p_executed_at, now()), p_note)
  returning * into e;
  return e;
end $$;

-- Settle a trade on the market outcome; commission is charged on positive net market P/L.
create or replace function public.settle_trade(p_trade uuid, p_outcome trade_outcome, p_closed_at timestamptz default null)
returns trades language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user(); t trades; v_pnl numeric;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.user_id <> v_user then raise exception 'NOT_FOUND: trade not found'; end if;
  if t.status <> 'open' then raise exception 'ALREADY_SETTLED: trade is already settled'; end if;
  v_pnl := private.trade_pnl(t.id, p_outcome);
  if v_pnl > 0 and p_outcome <> 'void' then v_pnl := v_pnl * (1 - t.commission); end if;
  v_pnl := round(v_pnl, 2);
  update trades set status = case when p_outcome = 'void' then 'void' else 'settled' end::trade_status, outcome = p_outcome,
                    realized_pnl = v_pnl, closed_at = coalesce(p_closed_at, now())
   where id = t.id returning * into t;
  if v_pnl <> 0 then
    perform private.post_tx(v_user, t.bankroll_id, 'trade_settlement', round(v_pnl * t.fx_rate, 2), null, t.id,
                            format('Trade %s: %s', p_outcome, t.selection), coalesce(p_closed_at, now()));
  end if;
  return t;
end $$;

-- ── Odds: closing prices ─────────────────────────────────────────────────────

-- Mark the last pre-start snapshot per (market, bookmaker, selection) as closing. Service role.
create or replace function public.mark_closing_odds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with started as (
    select mk.id as market_id, e.start_time from events e join markets mk on mk.event_id = e.id
     where e.start_time <= now() and e.start_time > now() - interval '7 days'
  ), last_pre as (
    select distinct on (s.market_id, s.bookmaker_id, s.selection) s.id
      from odds_snapshots s join started st on st.market_id = s.market_id
     where s.captured_at <= st.start_time and not s.is_live
     order by s.market_id, s.bookmaker_id, s.selection, s.captured_at desc
  )
  update odds_snapshots o set is_closing = true from last_pre lp where o.id = lp.id and not o.is_closing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mark_closing_odds() from public, anon, authenticated;

-- Copy closing prices from stored snapshots onto the user's bets that are linked to a
-- market and have no closing odds. Reference bookmaker: user setting, else the bet's book.
create or replace function private.capture_closing_odds(p_user uuid) returns int
language plpgsql as $$
declare n int;
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
  )
  update bets b set closing_odds = split_part(c.px, '|', 1)::numeric,
                    closing_source = 'snapshot:' || split_part(c.px, '|', 2), closing_captured_at = now()
    from cand c where c.bet_id = b.id and c.px is not null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.capture_closing_odds() returns int
language plpgsql security definer set search_path = public as $$
begin return private.capture_closing_odds(private.require_user()); end $$;

-- ── Performance snapshots (daily, per bankroll) ─────────────────────────────

create or replace function private.refresh_performance_snapshots(p_user uuid) returns int
language plpgsql as $$
declare n int;
begin
  delete from performance_snapshots where user_id = p_user;
  insert into performance_snapshots (user_id, is_demo, bankroll_id, snapshot_date, balance, open_exposure, equity, net_deposits,
                                     cum_profit, cum_staked, settled_bets, peak_equity, drawdown_pct)
  select p_user, br.is_demo, br.id, d.day,
         coalesce(tx.bal, 0), coalesce(op.exposure, 0), coalesce(tx.bal, 0) + coalesce(op.exposure, 0),
         coalesce(tx.capital, 0), coalesce(pf.profit, 0) + coalesce(tr.pnl, 0), coalesce(pf.staked, 0), coalesce(pf.n, 0),
         0, 0
  from bankrolls br
  cross join lateral generate_series(
      (select coalesce(min(occurred_at)::date, current_date) from bankroll_transactions where bankroll_id = br.id), current_date, interval '1 day') as d(day)
  left join lateral (
      select sum(amount) as bal,
             sum(amount) filter (where type in ('deposit','withdrawal','transfer_in','transfer_out','adjustment')) as capital
        from bankroll_transactions where bankroll_id = br.id and occurred_at < d.day + interval '1 day') tx on true
  left join lateral (
      select sum(round(profit * fx_rate, 2)) as profit, sum(round(stake * fx_rate, 2)) as staked, count(*) as n
        from bets where bankroll_id = br.id and deleted_at is null and status <> 'pending' and settled_at < d.day + interval '1 day') pf on true
  left join lateral (
      select sum(round(realized_pnl * fx_rate, 2)) as pnl from trades where bankroll_id = br.id and status <> 'open' and closed_at < d.day + interval '1 day') tr on true
  left join lateral (
      select sum(round(liability * fx_rate, 2)) as exposure from bets
       where bankroll_id = br.id and deleted_at is null and placed_at < d.day + interval '1 day'
         and (status = 'pending' or settled_at >= d.day + interval '1 day')) op on true
  where br.user_id = p_user;
  get diagnostics n = row_count;
  -- running peak of (net deposits + cumulative profit peak) and drawdown on betting P/L
  update performance_snapshots ps set
    peak_equity = x.net_deposits + x.peak_profit,
    drawdown_pct = case when x.net_deposits + x.peak_profit > 0
                        then round((x.peak_profit - x.cum_profit) / (x.net_deposits + x.peak_profit), 6) else 0 end
  from (select id, net_deposits, cum_profit,
               greatest(0, max(cum_profit) over (partition by bankroll_id order by snapshot_date)) as peak_profit
          from performance_snapshots where user_id = p_user) x
  where ps.id = x.id;
  return n;
end $$;

create or replace function public.refresh_performance_snapshots() returns int
language plpgsql security definer set search_path = public as $$
begin return private.refresh_performance_snapshots(private.require_user()); end $$;

-- ── Workspace mode & demo data ───────────────────────────────────────────────

create or replace function public.set_workspace_mode(p_mode workspace_mode) returns workspace_mode
language plpgsql security definer set search_path = public as $$
declare v_user uuid := private.require_user();
begin
  update user_settings set mode = p_mode, updated_at = now() where user_id = v_user;
  return p_mode;
end $$;

-- Delete every demo row of the caller. Live rows are never touched (is_demo = false).
create or replace function private.purge_demo(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('bep.purge', 'on', true);
  delete from alerts where user_id = p_user and is_demo;
  delete from goals where user_id = p_user and is_demo;
  delete from performance_snapshots where user_id = p_user and is_demo;
  delete from bankroll_transactions where user_id = p_user and is_demo;
  delete from bets where user_id = p_user and is_demo;
  delete from trades where user_id = p_user and is_demo;
  delete from bankrolls where user_id = p_user and is_demo;
  delete from strategies where user_id = p_user and is_demo;
  delete from events where owner_id = p_user and is_demo;     -- cascades markets & snapshots
  perform set_config('bep.purge', 'off', true);
end $$;

-- Replace the caller's demo workspace with the supplied dataset in one transaction.
-- Payload (generated by src/lib/demo): { bankrolls[], strategies[], bets[], trades[], events[] }
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
    insert into events (owner_id, is_demo, sport_id, name, home, away, start_time, status, provider, external_id)
    values (v_user, true, private.resolve_sport(x, v_user), x->>'name', x->>'home', x->>'away', (x->>'start_time')::timestamptz,
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

  for x in select * from jsonb_array_elements(coalesce(p->'trades','[]')) loop
    v_book := private.resolve_bookmaker(x, v_user);
    insert into trades (user_id, is_demo, bankroll_id, sport_id, event_name, market, selection, bookmaker_id, currency, commission, is_live, opened_at, notes)
    values (v_user, true, (v_bank->>(x->>'bankroll'))::uuid, private.resolve_sport(x, v_user), x->>'event_name', x->>'market', x->>'selection',
            v_book, x->>'currency', coalesce((x->>'commission')::numeric, 0), true, (x->>'opened_at')::timestamptz, x->>'notes')
    returning * into t;
    insert into trade_executions (trade_id, side, odds, stake, amount, executed_at)
    select t.id, (e->>'side')::execution_side, nullif(e->>'odds','')::numeric, (e->>'stake')::numeric, nullif(e->>'amount','')::numeric, (e->>'executed_at')::timestamptz
      from jsonb_array_elements(x->'executions') e;
    if x ? 'outcome' then
      declare v_pnl numeric; begin
        v_pnl := private.trade_pnl(t.id, (x->>'outcome')::trade_outcome);
        if v_pnl > 0 then v_pnl := v_pnl * (1 - t.commission); end if;
        v_pnl := round(v_pnl, 2);
        update trades set status = 'settled', outcome = (x->>'outcome')::trade_outcome, realized_pnl = v_pnl, closed_at = (x->>'closed_at')::timestamptz where id = t.id;
        if v_pnl <> 0 then
          perform private.post_tx(v_user, t.bankroll_id, 'trade_settlement', v_pnl, null, t.id, 'Trade settled', (x->>'closed_at')::timestamptz);
        end if;
      end;
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

create or replace function public.clear_demo_data() returns void
language plpgsql security definer set search_path = public as $$
begin perform private.purge_demo(private.require_user()); end $$;

-- ── Signup bootstrap ─────────────────────────────────────────────────────────

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  insert into profiles (id, email) values (new.id, new.email) on conflict do nothing;
  insert into user_settings (user_id) values (new.id) on conflict do nothing;
  insert into risk_limits (user_id, is_demo) values (new.id, false), (new.id, true) on conflict do nothing;
  insert into bankrolls (user_id, is_demo, name, kind, currency) values (new.id, false, 'Main', 'main', 'EUR') returning id into b;
  update user_settings set default_bankroll_id = b where user_id = new.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Integrity guards ─────────────────────────────────────────────────────────

create or replace function private.guard_ledger() returns trigger
language plpgsql as $$
begin
  if current_setting('bep.purge', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then raise exception 'LEDGER_IMMUTABLE: bankroll transactions are append-only'; end if;
  if tg_op = 'DELETE' and current_user in ('authenticated','anon') then
    raise exception 'LEDGER_IMMUTABLE: bankroll transactions are append-only';
  end if;
  return old;
end $$;
create trigger bankroll_tx_guard before update or delete on bankroll_transactions
  for each row execute function private.guard_ledger();

create or replace function private.guard_bankroll() returns trigger
language plpgsql as $$
begin
  if new.balance is distinct from old.balance and coalesce(current_setting('bep.ledger', true), 'off') <> 'on' then
    raise exception 'LEDGER_IMMUTABLE: bankroll balance can only change through transactions';
  end if;
  if new.user_id <> old.user_id or new.is_demo <> old.is_demo then
    raise exception 'VALIDATION: bankroll owner and mode are immutable';
  end if;
  if new.currency <> old.currency and exists (select 1 from bankroll_transactions where bankroll_id = old.id) then
    raise exception 'VALIDATION: currency cannot change once a bankroll has transactions';
  end if;
  return new;
end $$;
create trigger bankroll_guard before update on bankrolls for each row execute function private.guard_bankroll();

create or replace function private.guard_bankroll_insert() returns trigger
language plpgsql as $$
begin new.balance := 0; return new; end $$;
create trigger bankroll_insert_guard before insert on bankrolls for each row execute function private.guard_bankroll_insert();

-- ── Audit trail ──────────────────────────────────────────────────────────────

create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_user uuid;
begin
  if current_setting('bep.purge', true) = 'on' then return coalesce(new, old); end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'user_id', to_jsonb(old)->>'user_id');
  v_user := coalesce(auth.uid(), (coalesce(to_jsonb(new), to_jsonb(old))->>'user_id')::uuid);
  insert into audit_logs (user_id, actor, entity, entity_id, action, before, after)
  values (v_user, case when auth.uid() is null then 'system' else 'user' end, tg_table_name, v_id, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_bets after insert or update or delete on bets for each row execute function private.audit();
create trigger audit_bankroll_tx after insert on bankroll_transactions for each row execute function private.audit();
create trigger audit_bankrolls after insert or update or delete on bankrolls for each row execute function private.audit();
create trigger audit_trades after insert or update or delete on trades for each row execute function private.audit();
create trigger audit_strategies after insert or update or delete on strategies for each row execute function private.audit();
create trigger audit_risk_limits after insert or update on risk_limits for each row execute function private.audit();
create trigger audit_settings after update on user_settings for each row execute function private.audit();
create trigger audit_api_connections after insert or update or delete on api_connections for each row execute function private.audit();

-- updated_at maintenance
create or replace function private.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_profiles before update on profiles for each row execute function private.touch();
create trigger touch_api_connections before update on api_connections for each row execute function private.touch();
create trigger touch_risk_limits before update on risk_limits for each row execute function private.touch();

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.mark_closing_odds() from authenticated;
