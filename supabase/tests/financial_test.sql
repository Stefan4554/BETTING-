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
  assert b.status = 'won' and b.profit = 30 and b.actual_payout = 40, format('acca factor profit %s', b.profit);

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
