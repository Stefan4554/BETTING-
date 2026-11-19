-- Verifies RLS isolation, role protection and the bet-profit trigger.
-- Run: scripts/test-db.sh (plain Postgres + supabase_stubs.sql)
\set ON_ERROR_STOP 1
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local');

do $$ begin
  assert (select count(*) from public.users) = 2, 'profile trigger should create 2 users';
end $$;

-- User A places bets
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into bets (user_id, event_label, selection, odds, stake, status) values
  ('00000000-0000-0000-0000-00000000000a', 'A v B', 'A', 2.50, 10, 'won'),
  ('00000000-0000-0000-0000-00000000000a', 'C v D', 'C', 1.80, 20, 'lost'),
  ('00000000-0000-0000-0000-00000000000a', 'E v F', 'E', 3.00, 10, 'half_won'),
  ('00000000-0000-0000-0000-00000000000a', 'G v H', 'G', 2.00, 10, 'pending');
do $$ begin
  assert (select profit from bets where event_label = 'A v B') = 15.00, 'won profit';
  assert (select profit from bets where event_label = 'C v D') = -20.00, 'lost profit';
  assert (select profit from bets where event_label = 'E v F') = 10.00, 'half-won profit';
  assert (select profit from bets where event_label = 'G v H') is null, 'pending profit null';
  assert (select settled_at from bets where event_label = 'A v B') is not null, 'settled_at set';
end $$;

-- A cannot insert a bet for B
do $$ begin
  begin
    insert into bets (user_id, event_label, selection, odds, stake) values
      ('00000000-0000-0000-0000-00000000000b', 'X', 'X', 2, 1);
    raise exception 'RLS should have blocked cross-user insert';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A cannot promote themselves to admin
do $$ begin
  begin
    update users set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'self-promotion should have been rejected';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select role from users where id = '00000000-0000-0000-0000-00000000000a') = 'user', 'self-promotion must fail';
end $$;
set role authenticated;

-- User B sees none of A's bets and no provider config
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from bets) = 0, 'B must not see A bets';
  assert (select count(*) from api_providers) = 0, 'non-admin must not see providers';
  assert (select count(*) from users) = 1, 'B sees only own profile';
end $$;
reset role;

-- Admin sees providers
update users set role = 'admin' where id = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from api_providers) = 4, 'admin sees providers';
end $$;
reset role;
\echo 'RLS tests passed'
