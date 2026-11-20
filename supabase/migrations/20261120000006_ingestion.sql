-- BETTING EDGE PRO — 0006 ingestion helpers (service role only)

-- Closing capture for a given user, called by the ingestion worker after each cycle.
create or replace function public.capture_closing_odds_for(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
begin return private.capture_closing_odds(p_user); end $$;
revoke execute on function public.capture_closing_odds_for(uuid) from public, anon, authenticated;
grant execute on function public.capture_closing_odds_for(uuid) to service_role;

-- Latest snapshot per (market, bookmaker, selection) for a set of markets (change detection).
create or replace function public.latest_snapshots(p_markets uuid[])
returns table (market_id uuid, bookmaker_id uuid, selection text, odds numeric, line numeric, suspended boolean, captured_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (s.market_id, s.bookmaker_id, s.selection) s.market_id, s.bookmaker_id, s.selection, s.odds, s.line, s.suspended, s.captured_at
    from odds_snapshots s where s.market_id = any(p_markets)
   order by s.market_id, s.bookmaker_id, s.selection, s.captured_at desc;
$$;
revoke execute on function public.latest_snapshots(uuid[]) from public, anon, authenticated;
grant execute on function public.latest_snapshots(uuid[]) to service_role;

-- Retention: keep full history for 120 days, then the opening/closing snapshots only.
create or replace function public.prune_odds_history(p_days int default 120) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from odds_snapshots s using events e
   where s.event_id = e.id and e.start_time < now() - make_interval(days => p_days) and not s.is_closing
     and s.id <> (select min(id) from odds_snapshots o where o.market_id = s.market_id and o.bookmaker_id = s.bookmaker_id and o.selection = s.selection);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.prune_odds_history(int) from public, anon, authenticated;
grant execute on function public.prune_odds_history(int) to service_role;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
