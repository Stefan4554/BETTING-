-- ════════════════════════════════════════════════════════════════════════════
-- Database-level financial & security tests. Run with scripts/test-db.sh.
-- Everything runs inside one transaction and is rolled back.
-- Each DO block asserts; ON_ERROR_STOP aborts on the first failure.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@test.local');

-- signup bootstrap
do $$ begin
  assert (select count(*) from profiles where email like '%@test.local') = 2, 'profiles created';
  assert (select count(*) from bankrolls b join profiles p on p.id = b.user_id where p.email like '%@test.local' and b.name = 'Main' and not b.is_demo) = 2, 'main bankroll per user';
  assert (select count(*) from risk_limits r join profiles p on p.id = r.user_id where p.email like '%@test.local') = 4, 'risk limits live+demo per user';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- ── capital flows & single-bet settlement ──────────────────────────────────
do $$
declare br uuid; b bets; v numeric;
  function_balance numeric;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  perform record_transaction(br, 'deposit', 1000, 'initial');
  assert (select balance from bankrolls where id = br) = 1000, 'deposit';

  -- won: 100 @ 2.50 → +150
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'A v B', 'selection', 'A', 'odds', 2.5, 'stake', 100, 'sport_key', 'football'));
  assert (select balance from bankrolls where id = br) = 900, 'stake reserved';
  assert b.liability = 100 and b.potential_payout = 250, 'back liability/payout';
  b := settle_bet(b.id, 'won');
  assert b.profit = 150 and b.actual_payout = 250, format('won profit %s', b.profit);
  assert (select balance from bankrolls where id = br) = 1150, 'won credited';

  -- double settlement is rejected
  begin
    perform settle_bet(b.id, 'lost');
    raise exception 'expected ALREADY_SETTLED';
  exception when others then assert sqlerrm like 'ALREADY_SETTLED%', sqlerrm; end;
  assert (select count(*) from bankroll_transactions where bet_id = b.id and type = 'bet_settlement') = 1, 'one settlement row';

  -- lost: 50 @ 1.80 → −50
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'C v D', 'selection', 'C', 'odds', 1.8, 'stake', 50));
  b := settle_bet(b.id, 'lost');
  assert b.profit = -50 and b.actual_payout = 0, 'lost';
  assert (select balance from bankrolls where id = br) = 1100, 'lost balance';

  -- void: stake returned
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'E v F', 'selection', 'E', 'odds', 3, 'stake', 20));
  b := settle_bet(b.id, 'void');
  assert b.profit = 0 and b.actual_payout = 20, 'void';
  assert (select balance from bankrolls where id = br) = 1100, 'void balance';

  -- half won (Asian quarter line): 100 @ 1.90 → +45
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'G v H', 'market', 'Asian Handicap', 'line', -0.25, 'selection', 'G -0.25', 'odds', 1.9, 'stake', 100));
  b := settle_bet(b.id, 'half_won');
  assert b.profit = 45 and b.actual_payout = 145, format('half won %s', b.profit);
  -- half lost: 100 @ 1.90 → −50
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'I v J', 'market', 'Asian Handicap', 'line', 0.25, 'selection', 'I +0.25', 'odds', 1.9, 'stake', 100));
  b := settle_bet(b.id, 'half_lost');
  assert b.profit = -50 and b.actual_payout = 50, 'half lost';
  assert (select balance from bankrolls where id = br) = 1095, format('after halves %s', (select balance from bankrolls where id = br));

  -- full cash-out: 100 @ 3.0 cashed for 140 → +40
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'K v L', 'selection', 'K', 'odds', 3, 'stake', 100));
  b := settle_bet(b.id, 'cashed_out', null, null, null, 140);
  assert b.profit = 40 and b.cashed_out_stake = 100 and b.cashout_amount = 140, 'full cashout';
  assert (select balance from bankrolls where id = br) = 1135, 'cashout balance';

  -- partial cash-out: 100 @ 4.0, close 40 stake for 70, then remaining 60 wins → 180 + 30 = 210
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'M v N', 'selection', 'M', 'odds', 4, 'stake', 100));
  b := partial_cashout(b.id, 40, 70);
  assert (select balance from bankrolls where id = br) = 1105, 'partial cashout credited';
  b := settle_bet(b.id, 'won');
  assert b.profit = 210 and b.actual_payout = 310, format('partial cashout then won %s / %s', b.profit, b.actual_payout);
  assert (select balance from bankrolls where id = br) = 1345, 'after partial cashout win';

  -- exchange commission on a back win: 100 @ 2.0, 5% → +95
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'O v P', 'selection', 'O', 'odds', 2, 'stake', 100, 'commission', 0.05));
  assert b.potential_payout = 195, 'payout net of commission';
  b := settle_bet(b.id, 'won');
  assert b.profit = 95, 'commission';
  assert (select balance from bankrolls where id = br) = 1440, 'commission balance';

  -- lay won: lay 50 @ 3.0 (liability 100), 2% commission → +49
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Q v R', 'selection', 'Q', 'side', 'lay', 'odds', 3, 'stake', 50, 'commission', 0.02));
  assert b.liability = 100, 'lay liability';
  assert (select balance from bankrolls where id = br) = 1340, 'liability reserved';
  b := settle_bet(b.id, 'won');
  assert b.profit = 49 and b.actual_payout = 149, format('lay won %s', b.profit);
  -- lay lost: lay 20 @ 4.0 → −60
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'S v T', 'selection', 'S', 'side', 'lay', 'odds', 4, 'stake', 20));
  b := settle_bet(b.id, 'lost');
  assert b.profit = -60 and b.actual_payout = 0, 'lay lost';
  assert (select balance from bankrolls where id = br) = 1429, 'lay balance';
end $$;

-- ── accumulators ────────────────────────────────────────────────────────────
do $$
declare br uuid; b bets;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Treble', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name', 'L1', 'selection', 'X', 'odds', 2.0),
        jsonb_build_object('event_name', 'L2', 'selection', 'Y', 'odds', 1.5),
        jsonb_build_object('event_name', 'L3', 'selection', 'Z', 'odds', 3.0))));
  assert b.kind = 'accumulator' and b.odds = 9, format('acca odds %s', b.odds);
  assert b.potential_payout = 90, 'acca payout';
  -- one leg pending → cannot settle
  begin
    perform settle_bet(b.id, null, '[{"leg_no":1,"status":"won"}]'::jsonb);
    raise exception 'expected pending legs error';
  exception when others then assert sqlerrm like 'VALIDATION:%pending%', sqlerrm; end;
  -- won × void × half_won(3.0 → 2.0) = 4.0 → +30
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"won"},{"leg_no":2,"status":"void"},{"leg_no":3,"status":"half_won"}]'::jsonb);
  assert b.status = 'partial_win' and b.profit = 30 and b.actual_payout = 40, format('acca with a half-won leg is a partial win: %s %s', b.status, b.profit);

  -- a lost leg loses the accumulator even with others pending
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Double', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name', 'L1', 'selection', 'X', 'odds', 2.0),
        jsonb_build_object('event_name', 'L2', 'selection', 'Y', 'odds', 2.0))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"lost"}]'::jsonb);
  assert b.status = 'lost' and b.profit = -10, 'acca lost';
  -- all legs void → void, stake back
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Void double', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name', 'L1', 'selection', 'X', 'odds', 2.0),
        jsonb_build_object('event_name', 'L2', 'selection', 'Y', 'odds', 2.0))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"void"},{"leg_no":2,"status":"void"}]'::jsonb);
  assert b.status = 'void' and b.profit = 0, 'acca void';
  assert (select balance from bankrolls where id = br) = 1449, format('acca balance %s', (select balance from bankrolls where id = br));
end $$;

-- ── accumulators: result from the actual payout; leagues by name ────────────
do $$
declare br bankrolls; b bets; ep uuid;
begin
  br := create_bankroll('Acca tests', 'EUR', 'custom', null, 500);
  -- all legs won → won
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A1', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',2.0), jsonb_build_object('event_name','y','selection','y','odds',1.5))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"won"},{"leg_no":2,"status":"won"}]'::jsonb);
  assert b.status = 'won' and b.profit = 20, format('all won %s %s', b.status, b.profit);
  -- won × half_lost: payout = 10 × 2.0 × 0.5 = 10 = stake → break-even, NOT won
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A2', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',2.0), jsonb_build_object('event_name','y','selection','y -0.25','odds',1.9))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"won"},{"leg_no":2,"status":"half_lost"}]'::jsonb);
  assert b.status = 'break_even' and b.profit = 0 and b.actual_payout = 10, format('break-even %s %s', b.status, b.profit);
  -- payout below stake: 10 × 1.5 × 0.5 = 7.50 → partial loss −2.50 (previously mislabelled "won")
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A3', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',1.5), jsonb_build_object('event_name','y','selection','y','odds',1.9))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"won"},{"leg_no":2,"status":"half_lost"}]'::jsonb);
  assert b.status = 'partial_loss' and b.profit = -2.50 and b.actual_payout = 7.50, format('partial loss %s %s', b.status, b.profit);
  -- multiple Asian-handicap legs: half_won(1.9) × half_won(1.95) × won(2.0) = 1.45 × 1.475 × 2 = 4.2775 → +32.78
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A4', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x -0.25','odds',1.9), jsonb_build_object('event_name','y','selection','y +0.75','odds',1.95),
        jsonb_build_object('event_name','z','selection','z','odds',2.0))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"half_won"},{"leg_no":2,"status":"half_won"},{"leg_no":3,"status":"won"}]'::jsonb);
  assert b.status = 'partial_win' and b.profit = 32.78, format('multi-AH %s %s', b.status, b.profit);
  -- multiple void legs + one winner → odds reduce to the winner → won
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A5', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',1.8), jsonb_build_object('event_name','y','selection','y','odds',1.7),
        jsonb_build_object('event_name','z','selection','z','odds',2.5))));
  b := settle_bet(b.id, null, '[{"leg_no":1,"status":"void"},{"leg_no":2,"status":"void"},{"leg_no":3,"status":"won"}]'::jsonb);
  assert b.status = 'won' and b.profit = 15, format('voids reduce to 1.00 %s %s', b.status, b.profit);
  -- progressive leg results (partial settlement)
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A6', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',2.0), jsonb_build_object('event_name','y','selection','y','odds',1.8))));
  b := set_leg_results(b.id, '[{"leg_no":1,"status":"won"}]'::jsonb);
  assert b.status = 'pending' and (select status from bet_legs where bet_id = b.id and leg_no = 1) = 'won', 'leg result stored, bet still open';
  b := set_leg_results(b.id, '[{"leg_no":2,"status":"half_lost"}]'::jsonb);
  assert b.status = 'break_even' and b.profit = 0, format('auto-settled when last leg decided %s', b.status);
  -- a losing leg settles immediately even with legs open
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'A7', 'stake', 10, 'legs', jsonb_build_array(
        jsonb_build_object('event_name','x','selection','x','odds',2.0), jsonb_build_object('event_name','y','selection','y','odds',1.8))));
  b := set_leg_results(b.id, '[{"leg_no":2,"status":"lost"}]'::jsonb);
  assert b.status = 'lost' and b.profit = -10, 'lost leg settles acca';
  assert (select balance from bankrolls where id = br.id) = 500 + 20 + 0 - 2.50 + 32.78 + 15 + 0 - 10, 'acca bankroll';

  -- leagues resolved by name within the bet's sport; unknown names create a private league
  select id into ep from leagues where name = 'English Premier League' and owner_id is null;
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'L1', 'selection', 'x', 'odds', 2, 'stake', 1, 'sport_key', 'football', 'league_name', 'english premier league'));
  assert b.league_id = ep, 'platform league by name';
  b := place_bet(jsonb_build_object('bankroll_id', br.id, 'event_name', 'L2', 'selection', 'x', 'odds', 2, 'stake', 1, 'sport_key', 'tennis', 'league_name', 'English Premier League'));
  assert b.league_id <> ep and (select sport_id from leagues where id = b.league_id) = b.sport_id, 'never links a league of another sport';
  assert (select owner_id from leagues where id = b.league_id) = auth.uid(), 'unknown league created privately';
end $$;

-- ── reopen, edit, delete, bulk ──────────────────────────────────────────────
do $$
declare br uuid; b bets; first_bet uuid; ids uuid[];
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  select id into first_bet from bets where event_name = 'A v B';
  b := reopen_bet(first_bet);
  assert b.status = 'pending' and b.profit is null, 'reopened';
  assert (select balance from bankrolls where id = br) = 1199, 'settlement reversed';
  b := settle_bet(first_bet, 'lost');
  assert b.profit = -100 and b.settle_count = 2, 'resettled';
  assert (select balance from bankrolls where id = br) = 1199, 'resettle lost credit 0';

  -- reopen a cashed-out bet restores cash-out fields
  select * into b from bets where event_name = 'K v L';
  b := reopen_bet(b.id);
  assert b.cashed_out_stake = 0 and b.cashout_amount = 0, 'cashout fields restored';
  assert (select balance from bankrolls where id = br) = 1059, 'cashout reversed';
  b := settle_bet(b.id, 'cashed_out', null, null, null, 140);
  assert (select balance from bankrolls where id = br) = 1199, 're-cashed';

  -- editing financial fields of a settled bet is refused
  begin
    perform update_bet(first_bet, '{"stake": 10}'::jsonb);
    raise exception 'expected SETTLED_LOCKED';
  exception when others then assert sqlerrm like 'SETTLED_LOCKED%', sqlerrm; end;
  -- non-financial edits are allowed
  b := update_bet(first_bet, '{"notes": "edited", "closing_odds": 2.3, "tags": ["value","epl"]}'::jsonb);
  assert b.notes = 'edited' and b.closing_odds = 2.3 and b.closing_source = 'manual' and b.tags = '{value,epl}', 'non-financial edit';

  -- editing a pending bet moves the reservation
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'U v V', 'selection', 'U', 'odds', 2, 'stake', 100));
  assert (select balance from bankrolls where id = br) = 1099, 'reserved 100';
  b := update_bet(b.id, '{"stake": 40}'::jsonb);
  assert b.stake = 40 and b.liability = 40, 'stake edited';
  assert (select balance from bankrolls where id = br) = 1159, 'reservation adjusted';

  -- soft delete reverses the net ledger effect and preserves the row
  perform delete_bet(b.id);
  assert (select balance from bankrolls where id = br) = 1199, 'pending delete refunds';
  assert (select deleted_at is not null from bets where id = b.id), 'soft deleted';
  select id into first_bet from bets where event_name = 'C v D';
  perform delete_bet(first_bet);   -- settled lost −50 → +50
  assert (select balance from bankrolls where id = br) = 1249, 'settled delete reverses';

  -- bulk settle is all-or-nothing
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'W1', 'selection', 'W', 'odds', 2, 'stake', 10));
  ids := array[b.id];
  b := place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'W2', 'selection', 'W', 'odds', 3, 'stake', 10));
  ids := ids || b.id;
  begin
    perform bulk_settle(ids || first_bet, 'won');   -- first_bet is deleted → whole batch fails
    raise exception 'expected bulk failure';
  exception when others then assert sqlerrm like 'NOT_FOUND%', sqlerrm; end;
  assert (select count(*) from bets where id = any(ids) and status = 'pending') = 2, 'bulk rolled back';
  assert bulk_settle(ids, 'won') = 2, 'bulk settled';
  assert (select balance from bankrolls where id = br) = 1279, format('bulk balance %s', (select balance from bankrolls where id = br));
  assert bulk_update_bets(ids, '{"tags":["bulk"]}'::jsonb) = 2, 'bulk edit';
end $$;

-- ── withdrawals, transfers, FX, invariants ──────────────────────────────────
do $$
declare br uuid; gbp bankrolls; v_cap numeric; v_profit numeric; v_res numeric; v_bal numeric; b bets;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  perform record_transaction(br, 'withdrawal', 200);
  assert (select balance from bankrolls where id = br) = 1079, 'withdrawal';
  begin
    perform record_transaction(br, 'withdrawal', 5000);
    raise exception 'expected INSUFFICIENT_FUNDS';
  exception when others then assert sqlerrm like 'INSUFFICIENT_FUNDS%', sqlerrm; end;
  begin
    perform record_transaction(br, 'bet_settlement', 100);
    raise exception 'expected validation';
  exception when others then assert sqlerrm like 'VALIDATION%', sqlerrm; end;

  gbp := create_bankroll('Tennis GBP', 'GBP', 'sport');
  perform transfer_funds(br, gbp.id, 100, 0.85);
  assert (select balance from bankrolls where id = br) = 979, 'transfer out';
  assert (select balance from bankrolls where id = gbp.id) = 85, 'transfer in converted';

  -- cross-currency bet without a rate is refused; with an explicit locked rate it works
  begin
    perform place_bet(jsonb_build_object('bankroll_id', gbp.id, 'event_name', 'X v Y', 'selection', 'X', 'odds', 2, 'stake', 10, 'currency', 'USD'));
    raise exception 'expected FX_MISSING';
  exception when others then assert sqlerrm like 'FX_MISSING%', sqlerrm; end;
  insert into exchange_rates (owner_id, base, quote, rate, as_of) values (auth.uid(), 'USD', 'GBP', 0.8, current_date - 1);
  b := place_bet(jsonb_build_object('bankroll_id', gbp.id, 'event_name', 'X v Y', 'selection', 'X', 'odds', 2, 'stake', 10, 'currency', 'USD'));
  assert b.fx_rate = 0.8, 'fx locked at placement';
  assert (select balance from bankrolls where id = gbp.id) = 77, 'USD stake reserved in GBP';
  b := settle_bet(b.id, 'won');
  assert b.profit = 10, 'profit in bet currency';
  assert (select balance from bankrolls where id = gbp.id) = 93, 'payout converted at locked rate';

  -- ledger invariants for every bankroll
  for gbp in select * from bankrolls where user_id = auth.uid() loop
    select coalesce(sum(amount), 0) into v_bal from bankroll_transactions where bankroll_id = gbp.id;
    assert v_bal = gbp.balance, format('cache = ledger for %s', gbp.name);
    select coalesce(sum(amount), 0) into v_cap from bankroll_transactions
      where bankroll_id = gbp.id and type in ('deposit','withdrawal','transfer_in','transfer_out','adjustment');
    select coalesce(sum(round(profit * fx_rate, 2)), 0) into v_profit from bets where bankroll_id = gbp.id and status <> 'pending' and deleted_at is null;
    select coalesce(sum(round(liability * fx_rate, 2) - round(cashout_amount * fx_rate, 2)), 0)
      into v_res from bets where bankroll_id = gbp.id and status = 'pending' and deleted_at is null;
    assert gbp.balance = v_cap + v_profit - v_res,
      format('balance %s = capital %s + profit %s − open reservations %s (%s)', gbp.balance, v_cap, v_profit, v_res, gbp.name);
  end loop;
  assert (verify_bankroll(br)->>'consistent')::boolean, 'verify_bankroll';
end $$;

-- ── trading ─────────────────────────────────────────────────────────────────
do $$
declare br uuid; t trades; v numeric;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  t := open_trade(jsonb_build_object('bankroll_id', br, 'event_name', 'Live match', 'selection', 'Home', 'commission', 0.05,
       'executions', jsonb_build_array(jsonb_build_object('side','back','odds',3.0,'stake',100), jsonb_build_object('side','lay','odds',2.4,'stake',120))));
  -- win: 200 − 168 = 32 ; lose: −100 + 120 = 20
  set local role postgres;
  assert private.trade_pnl(t.id, 'win') = 32 and private.trade_pnl(t.id, 'lose') = 20, 'trade pnl scenarios';
  set local role authenticated;
  t := settle_trade(t.id, 'win');
  assert t.realized_pnl = 30.40, format('trade commission %s', t.realized_pnl);
  assert (select balance from bankrolls where id = br) = 1009.40, 'trade settled to bankroll';
  begin perform settle_trade(t.id, 'lose'); raise exception 'expected'; exception when others then assert sqlerrm like 'ALREADY_SETTLED%', sqlerrm; end;

  -- partial cash-out inside a trade: back 100 @ 4, cash out 50 stake for 80 → win: 150 + 30 = 180 ; lose: −50 + 30 = −20
  t := open_trade(jsonb_build_object('bankroll_id', br, 'event_name', 'Live 2', 'selection', 'Away',
       'executions', jsonb_build_array(jsonb_build_object('side','back','odds',4.0,'stake',100), jsonb_build_object('side','cashout','stake',50,'amount',80))));
  set local role postgres;
  assert private.trade_pnl(t.id, 'win') = 180 and private.trade_pnl(t.id, 'lose') = -20, 'trade partial cashout';
  set local role authenticated;
  t := settle_trade(t.id, 'lose');
  assert t.realized_pnl = -20, 'trade lose';
end $$;

-- ── live trading: exposure reserved in the ledger ─────────────────────────
do $$
declare br bankrolls; t trades; t2 trades; t3 trades; t4 trades; v0 numeric; x record;
begin
  br := create_bankroll('Trading', 'EUR', 'live', null, 1000);
  v0 := 1000;
  -- back position: the stake is reserved immediately
  t := open_trade(jsonb_build_object('bankroll_id', br.id, 'event_name', 'R1', 'selection', 'Home', 'commission', 0.05,
       'executions', jsonb_build_array(jsonb_build_object('side','back','odds',3.0,'stake',100))));
  assert t.reserved_base = 100 and (select balance from bankrolls where id = br.id) = v0 - 100, 'back stake reserved';
  -- hedge: lay 120 @ 2.4 → if win +32 / if lose +20 → nothing at risk → full release
  perform add_trade_execution(t.id, 'lay', 2.4, 120);
  select * into t from trades where id = t.id;
  assert t.reserved_base = 0 and (select balance from bankrolls where id = br.id) = v0, 'hedge releases reservation';
  -- lay position: liability 50 × (4 − 1) = 150 reserved
  t2 := open_trade(jsonb_build_object('bankroll_id', br.id, 'event_name', 'R2', 'selection', 'Away',
       'executions', jsonb_build_array(jsonb_build_object('side','lay','odds',4.0,'stake',50))));
  assert t2.reserved_base = 150, 'lay liability reserved';
  -- back position with partial then full cash-out
  t3 := open_trade(jsonb_build_object('bankroll_id', br.id, 'event_name', 'R3', 'selection', 'Draw',
       'executions', jsonb_build_array(jsonb_build_object('side','back','odds',4.0,'stake',100))));
  assert (select balance from bankrolls where id = br.id) = v0 - 250, 'multiple open positions reserved';
  assert (select sum(reserved_base) from trades where bankroll_id = br.id and status = 'open') = 250, 'reserved total';
  perform add_trade_execution(t3.id, 'cashout', null, 40, 70);   -- releases 40, realises +30
  select * into t3 from trades where id = t3.id;
  assert t3.reserved_base = 60 and t3.realized_partial = 30, format('partial close %s %s', t3.reserved_base, t3.realized_partial);
  assert (select balance from bankrolls where id = br.id) = v0 - 250 + 40 + 30, 'partial close credited';
  perform add_trade_execution(t3.id, 'cashout', null, 60, 90);   -- releases 60, realises +30
  select * into t3 from trades where id = t3.id;
  assert t3.reserved_base = 0 and t3.realized_partial = 60, 'fully closed by cash-out';
  t3 := settle_trade(t3.id, 'lose');
  assert t3.realized_pnl = 60, format('closed trade P/L %s', t3.realized_pnl);
  assert (select balance from bankrolls where id = br.id) = v0 - 150 + 60, 'final close posts no double count (lay reserved 150, +60 realised)';
  -- settle hedged trade (commission 5% on +32) and the lay (selection won → lay loses 150)
  t := settle_trade(t.id, 'win');
  assert t.realized_pnl = 30.40, 'commission on net market winnings';
  t2 := settle_trade(t2.id, 'win');
  assert t2.realized_pnl = -150, 'lay lost';
  assert (select balance from bankrolls where id = br.id) = v0 + 30.40 + 60 - 150, format('bankroll after closes %s', (select balance from bankrolls where id = br.id));
  -- reservations are never P/L: every closed trade's ledger entries sum to its realised P/L
  for x in select tr.id, tr.realized_pnl, (select sum(amount) from bankroll_transactions where trade_id = tr.id) as net,
                  (select count(*) from bankroll_transactions where trade_id = tr.id) as n
             from trades tr where tr.bankroll_id = br.id loop
    assert x.net = x.realized_pnl, format('trade %s ledger %s ≠ P/L %s', x.id, x.net, x.realized_pnl);
    assert x.n >= 2, 'opening and closing are both in the ledger';
  end loop;
  assert (select count(*) from bankroll_transactions where trade_id = t3.id) = 6, 'reserve, 2 releases, 2 realisations, settlement';
  -- reservation cannot exceed available funds
  begin
    perform open_trade(jsonb_build_object('bankroll_id', br.id, 'event_name', 'Too big', 'selection', 'x',
       'executions', jsonb_build_array(jsonb_build_object('side','lay','odds',20.0,'stake',100))));
    raise exception 'expected INSUFFICIENT_FUNDS';
  exception when others then assert sqlerrm like 'INSUFFICIENT_FUNDS%', sqlerrm; end;
  -- leave one position open for the global invariant check
  t4 := open_trade(jsonb_build_object('bankroll_id', br.id, 'event_name', 'R4', 'selection', 'x',
       'executions', jsonb_build_array(jsonb_build_object('side','back','odds',2.0,'stake',25), jsonb_build_object('side','cashout','stake',5,'amount',6))));
  assert t4.reserved_base = 20 and t4.realized_partial = 1, 'open trade with a partial close';
end $$;

-- ── ledger invariant across bets AND trades, every bankroll ─────────────────
do $$
declare b bankrolls; v_cap numeric; v_bets numeric; v_res numeric; v_trades numeric; v_open numeric;
begin
  for b in select * from bankrolls where user_id = auth.uid() loop
    select coalesce(sum(amount), 0) into v_cap from bankroll_transactions where bankroll_id = b.id and type in ('deposit','withdrawal','transfer_in','transfer_out','adjustment');
    select coalesce(sum(round(profit * fx_rate, 2)), 0) into v_bets from bets where bankroll_id = b.id and status <> 'pending' and deleted_at is null;
    select coalesce(sum(round(liability * fx_rate, 2) - round(cashout_amount * fx_rate, 2)), 0) into v_res from bets where bankroll_id = b.id and status = 'pending' and deleted_at is null;
    select coalesce(sum(round(realized_pnl * fx_rate, 2)), 0) into v_trades from trades where bankroll_id = b.id and status <> 'open';
    select coalesce(sum(realized_partial_base - reserved_base), 0) into v_open from trades where bankroll_id = b.id and status = 'open';
    assert b.balance = v_cap + v_bets - v_res + v_trades + v_open,
      format('%s: balance %s ≠ capital %s + bet P/L %s − bet reservations %s + trade P/L %s + open trades %s', b.name, b.balance, v_cap, v_bets, v_res, v_trades, v_open);
    assert (verify_bankroll(b.id)->>'consistent')::boolean, 'cache = ledger';
  end loop;
end $$;

-- ── notifications: preferences, email outbox, duplicates ───────────────────
do $$
declare v_id uuid; n int; r record;
begin
  -- defaults: bet_settled is off everywhere → alert dropped; risk alerts in-app only
  insert into alerts (user_id, type, title) values (auth.uid(), 'bet_settled', 'x');
  assert not exists (select 1 from alerts where user_id = auth.uid() and type = 'bet_settled'), 'opted-out alert dropped';
  insert into alerts (user_id, type, title, dedupe_key) values (auth.uid(), 'daily_loss', 'Daily loss', 'dl-1');
  assert (select in_app from alerts where dedupe_key = 'dl-1'), 'in-app by default';
  assert not exists (select 1 from email_outbox where user_id = auth.uid()), 'email is opt-in';
  -- opt in
  update user_settings set notification_email = 'alerts@test.local',
    notification_prefs = '{"daily_loss":{"in_app":true,"email":true},"bet_settled":{"in_app":false,"email":true},"large_loss":{"in_app":true,"email":true}}'
   where user_id = auth.uid();
  insert into alerts (user_id, type, title, body, dedupe_key) values (auth.uid(), 'daily_loss', 'Daily loss limit exceeded', '−120 of −100', 'dl-2');
  insert into alerts (user_id, type, title, dedupe_key) values (auth.uid(), 'daily_loss', 'dup', 'dl-2') on conflict do nothing;
  assert (select count(*) from email_outbox where user_id = auth.uid() and alert_type = 'daily_loss') = 1, 'one email per alert (dedupe)';
  select * into r from email_outbox where user_id = auth.uid() and alert_type = 'daily_loss';
  assert r.status = 'queued' and r.to_email = 'alerts@test.local' and r.subject like '%Daily loss limit exceeded', 'queued to the configured address';
  -- email-only preference: stored hidden from the in-app centre, email queued
  insert into alerts (user_id, type, title, dedupe_key) values (auth.uid(), 'bet_settled', 'Bet settled', 'bs-1');
  assert not (select in_app from alerts where dedupe_key = 'bs-1'), 'hidden in-app';
  assert exists (select 1 from email_outbox where user_id = auth.uid() and alert_type = 'bet_settled'), 'email queued';
  -- demo-workspace alerts never email
  insert into alerts (user_id, is_demo, type, title, dedupe_key) values (auth.uid(), true, 'daily_loss', 'demo', 'dl-demo');
  assert not exists (select 1 from email_outbox where dedupe_key = 'alert:dl-demo'), 'no email for demo';
  -- test email + rate limit
  v_id := queue_test_email();
  assert (select kind from email_outbox where id = v_id) = 'test', 'test email queued';
  perform queue_test_email(); perform queue_test_email(); perform queue_test_email(); perform queue_test_email();
  begin perform queue_test_email(); raise exception 'expected limit'; exception when others then assert sqlerrm like '%limit%', sqlerrm; end;
  -- clients cannot write the outbox
  begin
    update email_outbox set status = 'delivered' where user_id = auth.uid();
    raise exception 'expected denial';
  exception when insufficient_privilege then null; end;
  -- worker claims each email once (skip locked + attempts)
  set local role postgres;
  select count(*) into n from claim_email_batch(100);
  assert n >= 3, format('claimed %s', n);
  assert (select count(*) from claim_email_batch(100)) = 0, 'nothing claimed twice';
  assert (select bool_and(status = 'sending' and attempts = 1) from email_outbox where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'marked sending';
  set local role authenticated;
end $$;

-- ── risk limit enforcement ─────────────────────────────────────────────────
do $$
declare br uuid;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  update risk_limits set max_stake_per_bet = 50, max_event_exposure = 80, enforce = true where user_id = auth.uid() and not is_demo;
  begin
    perform place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Big', 'selection', 'A', 'odds', 2, 'stake', 60));
    raise exception 'expected RISK_LIMIT';
  exception when others then assert sqlerrm like 'RISK_LIMIT%', sqlerrm; end;
  perform place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'Corr', 'selection', 'A', 'odds', 2, 'stake', 50));
  begin
    perform place_bet(jsonb_build_object('bankroll_id', br, 'event_name', 'corr', 'selection', 'Over', 'odds', 2, 'stake', 40));
    raise exception 'expected event exposure limit';
  exception when others then assert sqlerrm like 'RISK_LIMIT%exposure%', sqlerrm; end;
  update risk_limits set enforce = false where user_id = auth.uid() and not is_demo;
end $$;

-- ── import with duplicates and bad rows ─────────────────────────────────────
do $$
declare br uuid; r jsonb;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  r := import_bets(br, jsonb_build_array(
    jsonb_build_object('_row', 1, 'placed_at', '2026-01-01T12:00:00Z', 'event_name', 'Imp v Ort', 'selection', 'Imp', 'odds', 2, 'stake', 10, 'status', 'won', 'bookmaker', 'Pinnacle'),
    jsonb_build_object('_row', 2, 'placed_at', '2026-01-01T12:00:00Z', 'event_name', 'Imp v Ort', 'selection', 'Imp', 'odds', 2, 'stake', 10, 'status', 'won', 'bookmaker', 'Pinnacle'),
    jsonb_build_object('_row', 3, 'event_name', 'Bad', 'selection', 'x', 'odds', 0.5, 'stake', 10),
    jsonb_build_object('_row', 4, 'placed_at', '2026-01-02T12:00:00Z', 'event_name', 'New Book', 'selection', 'y', 'odds', 3, 'stake', 5, 'status', 'lost', 'bookmaker', 'My Local Book')));
  assert (r->>'inserted')::int = 2 and (r->>'duplicates')::int = 1 and jsonb_array_length(r->'errors') = 1, r::text;
  assert (r->'errors'->0->>'row')::int = 3, 'error row number';
  assert exists (select 1 from bookmakers where owner_id = auth.uid() and name = 'My Local Book'), 'unknown bookmaker created privately';
end $$;

-- ── direct writes are blocked ───────────────────────────────────────────────
do $$
declare br uuid;
begin
  select id into br from bankrolls where name = 'Main' and not is_demo;
  begin
    insert into bankroll_transactions (user_id, bankroll_id, type, amount, balance_after) values (auth.uid(), br, 'deposit', 1e6, 1e6);
    raise exception 'expected denial';
  exception when insufficient_privilege then null; end;
  begin
    update bankrolls set balance = 1e6 where id = br;
    raise exception 'expected denial';
  exception when insufficient_privilege then null; end;
  begin
    update bets set profit = 1e6 where user_id = auth.uid();
    raise exception 'expected denial';
  exception when insufficient_privilege then null; end;
  begin
    perform private.post_tx(auth.uid(), br, 'deposit', 100);
    raise exception 'expected denial';
  exception when insufficient_privilege then null; end;
  -- renaming is allowed
  update bankrolls set name = 'Main EUR' where id = br;
  update bankrolls set name = 'Main' where id = br;
end $$;

-- ── data isolation between users ────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare alice_bet uuid; alice_br uuid; n int;
begin
  assert (select count(*) from bets) = 0, 'bob sees no bets';
  assert (select count(*) from bankroll_transactions) = 0, 'bob sees no transactions';
  assert (select count(*) from bankrolls) = 1, 'bob sees only his bankroll';
  assert (select count(*) from audit_logs) <= (select count(*) from audit_logs where user_id = auth.uid()), 'bob audit only own';
  assert (select count(*) from bookmakers where owner_id is not null) = 0, 'bob cannot see alice custom bookmaker';
  assert (select count(*) from email_outbox) = 0 and (select count(*) from trades) = 0, 'bob sees no emails or trades';
  assert (select count(*) from leagues where owner_id is not null) = 0, 'bob cannot see alice private league';
  set local role postgres;
  select id into alice_bet from bets where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status = 'pending' limit 1;
  select id into alice_br from bankrolls where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'Main';
  set local role authenticated;
  begin perform settle_bet(alice_bet, 'won'); raise exception 'expected'; exception when others then assert sqlerrm like 'NOT_FOUND%', sqlerrm; end;
  begin perform delete_bet(alice_bet); raise exception 'expected'; exception when others then assert sqlerrm like 'NOT_FOUND%', sqlerrm; end;
  begin perform record_transaction(alice_br, 'withdrawal', 10); raise exception 'expected'; exception when others then assert sqlerrm like 'NOT_FOUND%', sqlerrm; end;
  begin perform place_bet(jsonb_build_object('bankroll_id', alice_br, 'event_name', 'x', 'selection', 'x', 'odds', 2, 'stake', 1)); raise exception 'expected';
  exception when others then assert sqlerrm like 'NOT_FOUND%', sqlerrm; end;
  update bets set notes = 'hacked' where id = alice_bet;   -- no privilege / no rows
exception when insufficient_privilege then null;
end $$;

-- ── demo workspace isolation & reset ───────────────────────────────────────
do $$
declare r jsonb; live_bets int; live_bal numeric;
begin
  select count(*) into live_bets from bets;
  r := reset_demo_data('{
    "bankrolls":[{"name":"Demo Main","kind":"main","currency":"EUR","transactions":[{"type":"deposit","amount":500,"occurred_at":"2026-01-01T00:00:00Z"}]}],
    "strategies":[{"name":"Demo value","sport_key":"football"}],
    "events":[{"ref":"e1","name":"Demo FC v Sample Utd","home":"Demo FC","away":"Sample Utd","sport_key":"football","start_time":"2026-01-02T15:00:00Z","status":"finished",
               "markets":[{"key":"h2h","name":"Match Winner","snapshots":[
                 {"bookmaker":"pinnacle","selection":"Demo FC","odds":2.1,"at":"2026-01-01T10:00:00Z"},
                 {"bookmaker":"pinnacle","selection":"Demo FC","odds":1.95,"at":"2026-01-02T14:55:00Z"}]}]}],
    "bets":[{"bankroll":"Demo Main","event_name":"Demo FC v Sample Utd","selection":"Demo FC","odds":2.1,"stake":20,"status":"won","market_ref":"e1:h2h",
             "event_start":"2026-01-02T15:00:00Z","placed_at":"2026-01-01T10:05:00Z","strategy_name":"Demo value","bookmaker_key":"pinnacle"}],
    "trades":[{"bankroll":"Demo Main","event_name":"Demo live","market":"Match Odds","selection":"Demo FC","currency":"EUR","opened_at":"2026-01-02T15:10:00Z",
               "outcome":"win","closed_at":"2026-01-02T17:00:00Z","executions":[{"side":"back","odds":2.5,"stake":10,"executed_at":"2026-01-02T15:10:00Z"}]}]}'::jsonb);
  assert (r->>'bets')::int = 1, 'demo bets';
  assert (select mode from user_settings) = 'demo', 'mode switched to demo';
  assert (select count(*) from bets where is_demo) = 1, 'demo bet flagged';
  assert (select balance from bankrolls where is_demo) = 537, format('demo balance %s', (select balance from bankrolls where is_demo));
  assert (select count(*) from bets where not is_demo) = live_bets, 'live untouched';
  assert (select count(*) from performance_snapshots where is_demo) > 0, 'demo snapshots';
  assert (select count(*) from odds_snapshots where is_closing and owner_id = auth.uid()) = 1, 'demo closing marked';
  assert capture_closing_odds() = 1, 'closing captured from stored snapshots';
  assert (select closing_odds from bets where is_demo) = 1.95, 'closing = last pre-start price';
  assert (select closing_source from bets where is_demo) = 'snapshot:pinnacle', 'closing source labelled';
  perform clear_demo_data();
  assert (select count(*) from bets where is_demo) = 0 and (select count(*) from bankrolls where is_demo) = 0, 'demo cleared';
  assert (select count(*) from bankrolls where not is_demo) = 1, 'live bankroll kept';
end $$;

rollback;
\echo 'financial_test.sql: all assertions passed'
