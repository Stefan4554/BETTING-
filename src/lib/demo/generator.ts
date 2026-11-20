/**
 * Demo workspace dataset. Deterministic (seeded) and SIMULATED: fictional teams and players,
 * simulated prices and outcomes. It is loaded into rows flagged is_demo = true through the
 * same settlement functions as real bets, so every analytics feature can be explored safely.
 * It is never mixed with live data and is replaced wholesale by "Reset demo data".
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLUBS = ["Northbridge FC", "Riverside Athletic", "Port Calder", "Ashford Rovers", "Kingsmere United", "Valecrest City", "Harlow Town",
  "Eastmoor Albion", "Brightwater", "Stonegate Wanderers", "Fenwick County", "Oakhurst", "Millbrook Rangers", "Westhaven", "Corrin Bay", "Thornfield"];
const PLAYERS = ["A. Varga", "L. Moreau", "K. Tanaka", "D. Okafor", "S. Lindqvist", "M. Ferreira", "J. Novak", "R. Castell", "E. Brandt", "T. Halloran",
  "P. Ivanova", "C. Duarte", "H. Sato", "N. Kowal", "B. Arendt", "F. Romano"];
const HOOPS = ["Metro Hawks", "Bay Cyclones", "Capital Rush", "Summit Peaks", "Harbor Kings", "Desert Suns", "Lakeside Owls", "Iron City Forge",
  "Coastal Waves", "Granite Bears"];
const BOOKS = ["pinnacle", "bet365", "williamhill", "unibet", "betfair_ex", "betway"];

type Json = Record<string, unknown>;

export interface DemoDataset { bankrolls: Json[]; strategies: Json[]; bets: Json[]; trades: Json[]; events: Json[] }

export function buildDemoDataset(now = new Date(), seed = 20261120): DemoDataset {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  const iso = (t: number) => new Date(t).toISOString();
  const DAY = 86_400_000;
  const start = now.getTime() - 150 * DAY;

  const bankrolls: Json[] = [
    { name: "Main", kind: "main", currency: "EUR", transactions: [
      { type: "deposit", amount: 5000, occurred_at: iso(start - DAY), note: "Initial bankroll" },
      { type: "deposit", amount: 1500, occurred_at: iso(start + 70 * DAY), note: "Top-up" },
      { type: "withdrawal", amount: 800, occurred_at: iso(start + 120 * DAY), note: "Profit withdrawal" },
    ] },
    { name: "Tennis", kind: "sport", currency: "EUR", sport_key: "tennis", transactions: [{ type: "deposit", amount: 2000, occurred_at: iso(start - DAY) }] },
    { name: "Live Trading", kind: "live", currency: "EUR", transactions: [{ type: "deposit", amount: 1500, occurred_at: iso(start - DAY) }] },
  ];

  const strategies: Json[] = [
    { name: "Pinnacle value", sport_key: "football", description: "Back prices at soft books that beat the Pinnacle no-vig line by ≥3%.", entry_conditions: "Edge ≥ 3% vs no-vig sharp line", min_odds: 1.6, max_odds: 4, stake_rule: { type: "kelly", value: 0.25 }, color: "#3987e5" },
    { name: "Underdog AH", sport_key: "football", description: "Home underdogs on +0.25/+0.5 Asian lines.", entry_conditions: "Home team priced ≥ 2.6 in 1X2", min_odds: 1.8, max_odds: 2.3, stake_rule: { type: "flat", value: 50 }, color: "#d95926" },
    { name: "Tennis serve model", sport_key: "tennis", description: "Hold/break model edges pre-match.", entry_conditions: "Model edge ≥ 4pp", min_odds: 1.4, max_odds: 3.5, stake_rule: { type: "kelly", value: 0.2 }, color: "#199e70" },
    { name: "NBA totals", sport_key: "basketball", description: "Pace-adjusted totals.", entry_conditions: "Projected total differs ≥ 4 pts", min_odds: 1.85, max_odds: 2.1, stake_rule: { type: "units", value: 2 }, color: "#c98500" },
    { name: "In-play momentum", sport_key: "football", description: "Live overs after sustained pressure.", entry_conditions: "xG pressure index > 0.7 after 60'", stake_rule: { type: "flat", value: 25 }, color: "#d55181" },
  ];

  type Ctx = { sport: string; bankroll: string; strategy: string; event: string; home?: string; away?: string; league: string };
  const bets: Json[] = [];
  const N = 360;
  for (let i = 0; i < N; i++) {
    const t = start + (i / N) * (150 * DAY - 8 * 3_600_000) + r() * 6 * 3_600_000;
    const kindRoll = r();
    let c: Ctx;
    if (kindRoll < 0.55) {
      const h = pick(CLUBS); let a = pick(CLUBS); while (a === h) a = pick(CLUBS);
      c = { sport: "football", bankroll: "Main", strategy: r() < 0.6 ? "Pinnacle value" : r() < 0.5 ? "Underdog AH" : "In-play momentum", event: `${h} v ${a}`, home: h, away: a, league: "Premier Division (demo)" };
    } else if (kindRoll < 0.82) {
      const h = pick(PLAYERS); let a = pick(PLAYERS); while (a === h) a = pick(PLAYERS);
      c = { sport: "tennis", bankroll: "Tennis", strategy: "Tennis serve model", event: `${h} v ${a}`, home: h, away: a, league: "Tour (demo)" };
    } else {
      const h = pick(HOOPS); let a = pick(HOOPS); while (a === h) a = pick(HOOPS);
      c = { sport: "basketball", bankroll: "Main", strategy: "NBA totals", event: `${h} @ ${a}`, home: a, away: h, league: "Pro League (demo)" };
    }
    const live = c.strategy === "In-play momentum" || r() < 0.08;
    const pTrue = 0.25 + r() * 0.5;
    const edge = c.strategy === "Pinnacle value" ? 0.035 : c.strategy === "Tennis serve model" ? 0.03 : c.strategy === "In-play momentum" ? -0.01 : 0.01;
    const pMarket = Math.min(0.92, Math.max(0.08, pTrue - edge + (r() - 0.5) * 0.06));
    const margin = 1.025 + r() * 0.03;
    let odds = round(1 / (pMarket * margin), 2);
    if (odds <= 1.05) odds = 1.06;
    const pClose = Math.min(0.95, Math.max(0.05, pMarket + (pTrue - pMarket) * 0.6 + (r() - 0.5) * 0.03));
    const closing = round(Math.max(1.02, 1 / (pClose * 1.02)), 2);
    const opening = round(Math.max(1.02, odds * (1 + (r() - 0.45) * 0.08)), 2);
    const est = round(Math.min(0.95, Math.max(0.05, pTrue + (r() - 0.5) * 0.08)), 4);
    const book = live && r() < 0.4 ? "betfair_ex" : pick(BOOKS);
    const exchange = book === "betfair_ex";
    let market = "Match Winner", selection = c.home!, line: number | null = null, category = "result";
    if (c.strategy === "Underdog AH") { market = "Asian Handicap"; line = pick([0.25, 0.5, 0.75]); selection = `${c.home} +${line}`; category = "handicap"; }
    else if (c.strategy === "NBA totals") { market = "Totals"; line = round(210 + r() * 20, 0) + 0.5; selection = `${r() < 0.5 ? "Over" : "Under"} ${line}`; category = "totals"; }
    else if (c.strategy === "In-play momentum") { market = "Over / Under"; line = pick([1.5, 2.5, 2.25, 2.75]); selection = `Over ${line}`; category = "totals"; }
    else if (r() < 0.5) selection = c.away!;
    const stake = c.strategy === "Underdog AH" ? 50 : c.strategy === "In-play momentum" ? 25 : c.strategy === "NBA totals" ? 40
      : round(Math.max(10, Math.min(250, 4000 * Math.max(0.005, ((odds - 1) * est - (1 - est)) / (odds - 1)) * 0.25)), 0);
    const recent = t > now.getTime() - 4 * DAY;
    const win = r() < pTrue;
    let status: string = recent && r() < 0.85 ? "pending" : win ? "won" : "lost";
    const quarter = line != null && Math.abs((line * 4) % 2) === 1;
    if (status !== "pending" && quarter && r() < 0.3) status = win ? "half_won" : "half_lost";
    if (status !== "pending" && r() < 0.02) status = "void";
    const side = exchange && !live && r() < 0.35 ? "lay" : "back";
    let cashout: number | undefined;
    if (status !== "pending" && side === "back" && r() < 0.04) { status = "cashed_out"; cashout = round(stake * (0.5 + r() * (odds - 0.5)), 2); }
    const settledAt = t + (2 + r() * 20) * 3_600_000;
    const eventStart = live ? t - 50 * 60_000 : t + (1 + r() * 30) * 3_600_000;
    bets.push({
      bankroll: c.bankroll, placed_at: iso(t), sport_key: c.sport, event_name: c.event, home: c.home, away: c.away,
      event_start: iso(Math.min(eventStart, settledAt - 60_000)), is_live: live, market, market_category: category, selection, line,
      side, bookmaker_key: book, odds: side === "lay" ? round(odds + 0.04, 2) : odds, stake: side === "lay" ? Math.min(stake, 60) : stake, commission: exchange ? 0.05 : 0,
      est_probability: side === "lay" ? undefined : est, opening_odds: opening, closing_odds: status === "pending" ? undefined : closing,
      closing_source: status === "pending" ? undefined : "demo:simulated",
      strategy_name: c.strategy, confidence: 1 + Math.floor(r() * 5), units: round(stake / 25, 1),
      tags: [c.sport, live ? "live" : "prematch", ...(r() < 0.15 ? ["steam"] : [])],
      notes: r() < 0.1 ? "Simulated demo bet." : undefined,
      correlation_group: c.sport === "football" && r() < 0.1 ? `matchday-${Math.floor(i / 20)}` : undefined,
      status: side === "lay" && status === "won" ? "lost" : side === "lay" && status === "lost" ? "won" : status,
      cashout_amount: cashout, settled_at: status === "pending" ? undefined : iso(settledAt),
    });
  }
  // Accumulators
  for (let i = 0; i < 14; i++) {
    const t = start + r() * 140 * DAY;
    const legs = Array.from({ length: 2 + Math.floor(r() * 3) }, () => {
      const h = pick(CLUBS); let a = pick(CLUBS); while (a === h) a = pick(CLUBS);
      const o = round(1.35 + r() * 1.2, 2);
      const st = r() < 1 / o + 0.03 ? "won" : "lost";
      return { event_name: `${h} v ${a}`, market: "Match Winner", selection: h, odds: o, status: st };
    });
    bets.push({
      bankroll: "Main", placed_at: iso(t), sport_key: "football", event_name: `${legs.length}-fold accumulator`, market: "Accumulator",
      bookmaker_key: pick(["bet365", "williamhill", "unibet"]), stake: 10, legs, tags: ["acca"], strategy_name: undefined,
      settled_at: iso(t + 2 * DAY), event_start: iso(t + DAY),
    });
  }
  bets.sort((a, b) => String(a.placed_at).localeCompare(String(b.placed_at)));

  // Live trades (exchange back/lay with hedges and partial cash-outs)
  const trades: Json[] = [];
  for (let i = 0; i < 24; i++) {
    const t = start + 10 * DAY + r() * 135 * DAY;
    const h = pick(CLUBS); let a = pick(CLUBS); while (a === h) a = pick(CLUBS);
    const entry = round(2 + r() * 2.5, 2);
    const backStake = round(30 + r() * 70, 0);
    const moved = entry * (0.6 + r() * 0.7);
    const ex: Json[] = [{ side: "back", odds: entry, stake: backStake, executed_at: iso(t) }];
    if (r() < 0.7) {
      const layOdds = round(Math.max(1.05, moved), 2);
      ex.push({ side: "lay", odds: layOdds, stake: round((backStake * entry) / layOdds, 2), executed_at: iso(t + 35 * 60_000) });
    }
    const open = i >= 22;
    trades.push({
      bankroll: "Live Trading", sport_key: "football", event_name: `${h} v ${a}`, market: "Match Odds", selection: h, bookmaker_key: "betfair_ex",
      currency: "EUR", commission: 0.05, opened_at: iso(t), executions: ex,
      ...(open ? {} : { outcome: r() < 1 / entry ? "win" : "lose", closed_at: iso(t + 2 * 3_600_000) }),
      notes: open ? "Open simulated position" : undefined,
    });
  }

  // Odds-monitor events with simulated snapshots from several books
  const events: Json[] = [];
  for (let i = 0; i < 12; i++) {
    const h = pick(CLUBS); let a = pick(CLUBS); while (a === h) a = pick(CLUBS);
    const kick = now.getTime() + (2 + i * 5) * 3_600_000;
    const pH = 0.3 + r() * 0.35, pD = 0.22 + r() * 0.08, pA = Math.max(0.08, 1 - pH - pD);
    const sels: [string, number][] = [[h, pH], ["Draw", pD], [a, pA]];
    const snapshots: Json[] = [];
    for (const bk of ["pinnacle", "bet365", "williamhill", "unibet", "betway"]) {
      const m = bk === "pinnacle" ? 1.025 : 1.045 + r() * 0.03;
      for (const [sel, p] of sels) {
        let drift = 0;
        for (let k = 0; k < 8; k++) {
          drift += (r() - 0.5) * 0.02 + (i === 0 && sel === h ? -0.006 : 0);
          const px = Math.max(1.05, round(1 / ((p + drift) * m) * (i === 3 && bk === "unibet" && sel === a ? 1.12 : 1), 2));
          snapshots.push({ bookmaker: bk, selection: sel, odds: px, at: iso(now.getTime() - (24 - k * 3) * 3_600_000), suspended: i === 5 && k === 7 && bk === "bet365" });
        }
      }
    }
    events.push({ ref: `demo-ev-${i}`, name: `${h} v ${a}`, home: h, away: a, sport_key: "football", start_time: iso(kick), status: "scheduled",
      markets: [{ key: "h2h", name: "Match Winner", snapshots }] });
  }
  return { bankrolls, strategies, bets, trades, events };
}
