-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0004 row level security
--
--   * Platform catalogue/market rows (owner_id IS NULL) are readable by any signed-in user
--     and written only by the service role (which bypasses RLS).
--   * User-defined catalogue rows (owner_id = auth.uid()) are private and editable by owner.
--   * Financial rows (bets, legs, transactions, trades, executions, bankroll balances) are
--     SELECT-only for clients; every write goes through the SECURITY DEFINER RPCs in 0003.
--   * api_connection_secrets has RLS on and no policies: service role only.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_settings','sports','leagues','market_types','bookmakers','bookmaker_accounts','events','markets',
    'exchange_rates','odds_providers','api_connections','api_connection_secrets','api_request_logs','odds_snapshots',
    'bankrolls','strategies','bets','bet_legs','bet_notes','trades','trade_executions','bankroll_transactions',
    'risk_limits','goals','alerts','performance_snapshots','saved_views','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Table privileges: start from nothing, then grant what policies may further restrict.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on api_connection_secrets from authenticated;
grant insert, update, delete on sports, leagues, market_types, bookmakers, bookmaker_accounts, events, markets,
  exchange_rates, strategies, goals, saved_views to authenticated;
grant insert, update, delete on api_connections to authenticated;
grant update on profiles, user_settings, risk_limits, alerts to authenticated;
grant update (name, kind, sport_id, allow_negative, archived) on bankrolls to authenticated;
grant insert, delete on alerts to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ── Profiles & settings ──────────────────────────────────────────────────────
create policy profiles_own on profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_update on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));  -- no self-promotion
create policy settings_own on user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_own_update on user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy risk_own on risk_limits for select to authenticated using (user_id = auth.uid());
create policy risk_own_update on risk_limits for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Catalogue: platform rows readable, own rows writable ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['sports','leagues','market_types','bookmakers','exchange_rates'] loop
    execute format('create policy %I on %I for select to authenticated using (owner_id is null or owner_id = auth.uid())', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (owner_id = auth.uid())', t || '_own_insert', t);
    execute format('create policy %I on %I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_own_update', t);
    execute format('create policy %I on %I for delete to authenticated using (owner_id = auth.uid())', t || '_own_delete', t);
  end loop;
end $$;

create policy odds_providers_read on odds_providers for select to authenticated using (true);

-- Events: platform events visible to all; own (manual / own-key / demo) events private.
create policy events_read on events for select to authenticated
  using ((owner_id is null and not is_demo) or owner_id = auth.uid());
create policy events_own_insert on events for insert to authenticated with check (owner_id = auth.uid() and provider = 'manual');
create policy events_own_update on events for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy events_own_delete on events for delete to authenticated using (owner_id = auth.uid());

create policy markets_read on markets for select to authenticated
  using (exists (select 1 from events e where e.id = event_id and ((e.owner_id is null and not e.is_demo) or e.owner_id = auth.uid())));
create policy markets_own_write on markets for all to authenticated
  using (exists (select 1 from events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from events e where e.id = event_id and e.owner_id = auth.uid()));

create policy odds_snapshots_read on odds_snapshots for select to authenticated
  using ((owner_id is null and not is_demo) or owner_id = auth.uid());

-- ── Owner-only data ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  -- read-only for clients (writes via RPC)
  foreach t in array array['bankrolls','bets','trades','bankroll_transactions','performance_snapshots','bet_notes','audit_logs','api_request_logs'] loop
    execute format('create policy %I on %I for select to authenticated using (user_id = auth.uid())', t || '_own_select', t);
  end loop;
  -- full CRUD for owner
  foreach t in array array['strategies','goals','saved_views','bookmaker_accounts','api_connections'] loop
    execute format('create policy %I on %I for select to authenticated using (user_id = auth.uid())', t || '_own_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (user_id = auth.uid())', t || '_own_insert', t);
    execute format('create policy %I on %I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own_update', t);
    execute format('create policy %I on %I for delete to authenticated using (user_id = auth.uid())', t || '_own_delete', t);
  end loop;
end $$;

create policy bankrolls_own_update on bankrolls for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy bet_legs_own on bet_legs for select to authenticated
  using (exists (select 1 from bets b where b.id = bet_id and b.user_id = auth.uid()));
create policy trade_executions_own on trade_executions for select to authenticated
  using (exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid()));

create policy alerts_own_select on alerts for select to authenticated using (user_id = auth.uid());
create policy alerts_own_insert on alerts for insert to authenticated with check (user_id = auth.uid());
create policy alerts_own_update on alerts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy alerts_own_delete on alerts for delete to authenticated using (user_id = auth.uid());

-- Strategy ↔ mode consistency: a strategy can't silently move between demo and live.
create or replace function private.guard_mode_immutable() returns trigger language plpgsql as $$
begin
  if new.is_demo <> old.is_demo or new.user_id <> old.user_id then raise exception 'VALIDATION: owner and mode are immutable'; end if;
  return new;
end $$;
create trigger strategies_mode_guard before update on strategies for each row execute function private.guard_mode_immutable();
create trigger goals_mode_guard before update on goals for each row execute function private.guard_mode_immutable();
