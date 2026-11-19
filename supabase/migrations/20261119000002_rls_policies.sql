-- EDGE INTELLIGENCE — row-level security & role-based access
-- Model:
--   * Reference/market data (players, matches, odds ...) is readable by any signed-in user.
--     Only the service role (server-side ingestion workers) writes it; the service role bypasses RLS.
--   * User data (bets, bankroll, alerts, notifications, profile) is visible only to its owner.
--   * api_providers / api_logs are visible to admins only.

create or replace function public.current_role_is(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = r);
$$;

create or replace function public.user_role(uid uuid) returns app_role
language sql stable security definer set search_path = public as $$
  select u.role from public.users u where u.id = uid;
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_is('admin');
$$;

-- Enable RLS everywhere.
alter table users                 enable row level security;
alter table api_providers         enable row level security;
alter table api_logs              enable row level security;
alter table players               enable row level security;
alter table player_rankings       enable row level security;
alter table tournaments           enable row level security;
alter table matches               enable row level security;
alter table provider_entity_map   enable row level security;
alter table match_statistics      enable row level security;
alter table head_to_head          enable row level security;
alter table bookmakers            enable row level security;
alter table betting_markets       enable row level security;
alter table odds_snapshots        enable row level security;
alter table model_versions        enable row level security;
alter table predictions           enable row level security;
alter table value_opportunities   enable row level security;
alter table bets                  enable row level security;
alter table bankroll_transactions enable row level security;
alter table alert_rules           enable row level security;
alter table notifications         enable row level security;

-- Shared read-only reference & market data --------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'players','player_rankings','tournaments','matches','provider_entity_map','match_statistics',
    'head_to_head','bookmakers','betting_markets','odds_snapshots','model_versions','predictions',
    'value_opportunities'
  ] loop
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- Views inherit the caller's permissions on the base table.
alter view odds_latest set (security_invoker = true);
alter view odds_opening set (security_invoker = true);

-- Profiles ---------------------------------------------------------------
create policy users_select_own on users for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy users_update_own on users for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.user_role(auth.uid())); -- cannot self-promote
create policy users_admin_update on users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Owner-only user data ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bets','bankroll_transactions','alert_rules'] loop
    execute format('create policy %I on %I for select to authenticated using (user_id = auth.uid())', t || '_own_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (user_id = auth.uid())', t || '_own_insert', t);
    execute format('create policy %I on %I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own_update', t);
    execute format('create policy %I on %I for delete to authenticated using (user_id = auth.uid())', t || '_own_delete', t);
  end loop;
end $$;

-- Notifications are created by the server; users can read and mark them read.
create policy notifications_own_select on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin-only provider configuration & logs ------------------------------
create policy api_providers_admin_read on api_providers for select to authenticated using (public.is_admin());
create policy api_providers_admin_write on api_providers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy api_logs_admin_read on api_logs for select to authenticated using (public.is_admin());

-- Seed the provider registry (keys are configured via env vars, never here).
insert into api_providers (id, name, kind, base_url, rate_limit_per_minute) values
  ('the_odds_api',       'The Odds API',                      'odds',        'https://api.the-odds-api.com/v4', 30),
  ('sportradar_tennis',  'Sportradar Tennis API v3',          'sports_data', 'https://api.sportradar.com/tennis', 60),
  ('sportradar_odds',    'Sportradar Odds Comparison API',    'odds',        'https://api.sportradar.com/oddscomparison-prematch', 60),
  ('api_tennis',         'API-Tennis',                        'sports_data', 'https://api.api-tennis.com/tennis', 60)
on conflict (id) do nothing;
