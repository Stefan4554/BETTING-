-- EDGE INTELLIGENCE — support objects for background workers

-- Last evaluated market state per match, so alert rules can compare before/after.
create table alert_market_state (
  match_ref text primary key,            -- provider match id, e.g. 'sr:sport_event:123'
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table alert_market_state enable row level security;   -- service role only, no policies

-- Mark closing odds: the last pre-start snapshot for each (market, bookmaker, selection)
-- of matches that have started. Idempotent; run after each ingestion cycle.
create or replace function mark_closing_odds() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with started as (
    select bm.id as market_id, m.scheduled_at
    from matches m join betting_markets bm on bm.match_id = m.id
    where m.scheduled_at <= now() and m.scheduled_at > now() - interval '3 days'
  ),
  last_pre as (
    select distinct on (s.market_id, s.bookmaker_id, s.selection) s.id
    from odds_snapshots s join started st on st.market_id = s.market_id
    where s.captured_at <= st.scheduled_at and not s.is_live
    order by s.market_id, s.bookmaker_id, s.selection, s.captured_at desc
  )
  update odds_snapshots o set is_closing = true
  from last_pre lp where o.id = lp.id and not o.is_closing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function mark_closing_odds() from public, anon, authenticated;

-- Rules can target a provider match id (live feeds) as well as a stored match uuid.
alter table alert_rules add column match_ref text;
create index alert_rules_match_ref_idx on alert_rules (match_ref) where match_ref is not null;
