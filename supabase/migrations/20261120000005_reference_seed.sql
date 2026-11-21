-- ════════════════════════════════════════════════════════════════════════════
-- BETTING EDGE PRO — 0005 platform reference data (editable; users can add their own)
-- ════════════════════════════════════════════════════════════════════════════

insert into sports (key, name, sort_order, has_draw) values
  ('football','Football / Soccer',1,true), ('basketball','Basketball',2,false), ('tennis','Tennis',3,false),
  ('baseball','Baseball',4,false), ('american_football','American Football',5,false), ('ice_hockey','Ice Hockey',6,true),
  ('rugby','Rugby',7,true), ('cricket','Cricket',8,true), ('volleyball','Volleyball',9,false), ('handball','Handball',10,true),
  ('mma','MMA',11,true), ('boxing','Boxing',12,true), ('golf','Golf',13,false), ('table_tennis','Table Tennis',14,false),
  ('esports','Esports',15,false), ('darts','Darts',16,false), ('badminton','Badminton',17,false), ('other','Other',99,false);

-- Generic markets (sport_id null) usable for every sport.
insert into market_types (key, name, category, has_line, outcomes, settlement, provider_keys) values
  ('match_winner','Match Winner (1X2)','result',false,'{Home,Draw,Away}','multi','{"the_odds_api":"h2h","api_football":"Match Winner"}'),
  ('moneyline','Moneyline','result',false,'{Home,Away}','binary','{"the_odds_api":"h2h"}'),
  ('draw_no_bet','Draw No Bet','result',false,'{Home,Away}','binary','{"api_football":"Home/Away"}'),
  ('double_chance','Double Chance','result',false,'{1X,12,X2}','binary','{"api_football":"Double Chance"}'),
  ('asian_handicap','Asian Handicap','handicap',true,'{Home,Away}','quarter','{"the_odds_api":"spreads","api_football":"Asian Handicap"}'),
  ('european_handicap','European Handicap','handicap',true,'{Home,Draw,Away}','multi','{}'),
  ('spread','Point Spread','handicap',true,'{Home,Away}','binary','{"the_odds_api":"spreads"}'),
  ('over_under','Over / Under','totals',true,'{Over,Under}','quarter','{"the_odds_api":"totals","api_football":"Goals Over/Under"}'),
  ('totals','Totals','totals',true,'{Over,Under}','binary','{"the_odds_api":"totals"}'),
  ('btts','Both Teams To Score','props',false,'{Yes,No}','binary','{"api_football":"Both Teams Score"}'),
  ('correct_score','Correct Score','specials',false,'{}','multi','{"api_football":"Exact Score"}'),
  ('player_props','Player Props','props',true,'{Over,Under}','binary','{}'),
  ('outright','Outright / Futures','specials',false,'{}','multi','{"the_odds_api":"outrights"}'),
  ('custom','Custom Market','other',false,'{}','binary','{}');

-- Sport-specific markets.
insert into market_types (sport_id, key, name, category, has_line, outcomes, settlement)
select s.id, m.key, m.name, m.category, m.has_line, m.outcomes, m.settlement
from (values
  ('tennis','set_betting','Set Betting','specials',false,'{}'::text[],'multi'),
  ('tennis','game_handicap','Game Handicap','handicap',true,'{Home,Away}','binary'),
  ('tennis','total_games','Total Games','totals',true,'{Over,Under}','binary'),
  ('basketball','player_points','Player Points','props',true,'{Over,Under}','binary'),
  ('basketball','race_to_points','Race to Points','specials',true,'{Home,Away}','binary'),
  ('ice_hockey','puck_line','Puck Line','handicap',true,'{Home,Away}','binary'),
  ('baseball','run_line','Run Line','handicap',true,'{Home,Away}','binary'),
  ('cricket','top_batsman','Top Batter','props',false,'{}','multi'),
  ('mma','method_of_victory','Method of Victory','specials',false,'{}','multi'),
  ('boxing','round_betting','Round Betting','specials',false,'{}','multi'),
  ('golf','top_finish','Top 5/10/20 Finish','specials',false,'{}','binary'),
  ('darts','most_180s','Most 180s','props',false,'{Home,Away}','binary'),
  ('esports','map_handicap','Map Handicap','handicap',true,'{Home,Away}','binary'),
  ('football','corners','Total Corners','totals',true,'{Over,Under}','quarter'),
  ('football','cards','Total Cards','totals',true,'{Over,Under}','binary')
) as m(sport, key, name, category, has_line, outcomes, settlement)
join sports s on s.key = m.sport and s.owner_id is null;

insert into leagues (sport_id, name, country, provider_keys)
select s.id, l.name, l.country, l.pk::jsonb from (values
  ('football','English Premier League','England','{"the_odds_api":"soccer_epl","api_football":"39"}'),
  ('football','La Liga','Spain','{"the_odds_api":"soccer_spain_la_liga","api_football":"140"}'),
  ('football','Serie A','Italy','{"the_odds_api":"soccer_italy_serie_a","api_football":"135"}'),
  ('football','Bundesliga','Germany','{"the_odds_api":"soccer_germany_bundesliga","api_football":"78"}'),
  ('football','Ligue 1','France','{"the_odds_api":"soccer_france_ligue_one","api_football":"61"}'),
  ('football','UEFA Champions League','Europe','{"the_odds_api":"soccer_uefa_champs_league","api_football":"2"}'),
  ('basketball','NBA','USA','{"the_odds_api":"basketball_nba"}'),
  ('basketball','EuroLeague','Europe','{"the_odds_api":"basketball_euroleague"}'),
  ('tennis','ATP Tour','World','{}'),
  ('tennis','WTA Tour','World','{}'),
  ('baseball','MLB','USA','{"the_odds_api":"baseball_mlb"}'),
  ('american_football','NFL','USA','{"the_odds_api":"americanfootball_nfl"}'),
  ('ice_hockey','NHL','USA','{"the_odds_api":"icehockey_nhl"}'),
  ('mma','UFC','World','{"the_odds_api":"mma_mixed_martial_arts"}'),
  ('cricket','Indian Premier League','India','{"the_odds_api":"cricket_ipl"}'),
  ('rugby','Six Nations','Europe','{"the_odds_api":"rugbyunion_six_nations"}')
) as l(sport, name, country, pk)
join sports s on s.key = l.sport and s.owner_id is null;

insert into bookmakers (key, name, is_exchange, default_commission, provider_keys) values
  ('pinnacle','Pinnacle',false,0,'{"the_odds_api":"pinnacle"}'),
  ('bet365','bet365',false,0,'{"api_football":"8"}'),
  ('betfair_ex','Betfair Exchange',true,0.05,'{"the_odds_api":"betfair_ex_uk"}'),
  ('betfair_sb','Betfair Sportsbook',false,0,'{"the_odds_api":"betfair_sb_uk"}'),
  ('smarkets','Smarkets',true,0.02,'{"the_odds_api":"smarkets"}'),
  ('matchbook','Matchbook',true,0.02,'{"the_odds_api":"matchbook"}'),
  ('williamhill','William Hill',false,0,'{"the_odds_api":"williamhill"}'),
  ('unibet','Unibet',false,0,'{"the_odds_api":"unibet_eu"}'),
  ('bwin','bwin',false,0,'{}'),
  ('betway','Betway',false,0,'{"the_odds_api":"betway"}'),
  ('onexbet','1xBet',false,0,'{"the_odds_api":"onexbet"}'),
  ('marathonbet','Marathonbet',false,0,'{"the_odds_api":"marathonbet"}'),
  ('draftkings','DraftKings',false,0,'{"the_odds_api":"draftkings"}'),
  ('fanduel','FanDuel',false,0,'{"the_odds_api":"fanduel"}'),
  ('betmgm','BetMGM',false,0,'{"the_odds_api":"betmgm"}'),
  ('other','Other',false,0,'{}');

insert into odds_providers (id, name, kind, base_url, docs_url, auth_scheme, default_rate_limit_per_minute, min_refresh_seconds, supports_live, supports_history, implemented, notes) values
  ('the_odds_api','The Odds API','odds','https://api.the-odds-api.com/v4','https://the-odds-api.com/liveapi/guides/v4/','query:apiKey',30,60,true,true,true,
   'Multi-sport bookmaker odds. Each odds request costs markets × regions credits; remaining quota is reported per response.'),
  ('api_football','API-Football (API-Sports)','odds_and_data','https://v3.football.api-sports.io','https://www.api-football.com/documentation-v3','header:x-apisports-key',10,300,false,false,true,
   'Football fixtures and pre-match bookmaker odds. Free tier: 100 requests/day.'),
  ('sportradar','Sportradar Odds Comparison','odds','https://api.sportradar.com','https://developer.sportradar.com','query:api_key',60,60,true,true,false,
   'Enterprise licence required. Adapter not implemented in this release; listed for planning.');

-- Exchange rates are NOT seeded: they come from the ECB reference-rate job (/api/cron/fx)
-- or are entered by the user. A missing rate blocks cross-currency bets instead of guessing.
