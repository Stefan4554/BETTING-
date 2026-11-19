/** DEMO DATA — fictional bet history for the tracker in demo mode. */
import type { Bet } from "../engine/bets";
import { DEMO_BOOKMAKERS } from "./generator";

export function demoBets(now = new Date()): Bet[] {
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const markets = ["match_winner", "match_winner", "match_winner", "total_games", "game_handicap", "set_winner"];
  const bets: Bet[] = [];
  for (let i = 0; i < 80; i++) {
    const placed = new Date(now.getTime() - (79 - i) * 22 * 3600_000 - 5 * 3600_000);
    const odds = Math.round((1.4 + r() * 2.2) * 100) / 100;
    const p = (1 / odds) * (1.02 + r() * 0.03);
    const pending = i >= 76;
    const roll = r();
    const status: Bet["status"] = pending ? "pending" : roll < 0.03 ? "void" : roll < p ? "won" : "lost";
    const book = DEMO_BOOKMAKERS[Math.floor(r() * DEMO_BOOKMAKERS.length)]!;
    bets.push({
      id: `demo-bet-${i}`,
      placedAt: placed.toISOString(),
      settledAt: pending ? null : new Date(placed.getTime() + 3 * 3600_000).toISOString(),
      sport: "tennis",
      eventLabel: `Demo match #${i + 1}`,
      market: markets[Math.floor(r() * markets.length)]!,
      selection: r() < 0.5 ? "Player A" : "Player B",
      bookmaker: book.name,
      odds,
      stake: Math.round(10 + r() * 40),
      closingOdds: Math.round(odds * (0.94 + r() * 0.1) * 100) / 100,
      status,
      notes: null,
    });
  }
  return bets;
}
