import "server-only";
import type { Bet } from "../engine/bets";
import { isDemoMode } from "../env";
import { demoBets } from "../demo/bets";
import { supabaseServer } from "../supabase/server";

export type BetStorage = "demo" | "supabase" | "local";

/**
 * Where bets live:
 *  - demo: fictional sample history (read-only seed; edits stay in the browser)
 *  - supabase: the signed-in user's rows (RLS-protected)
 *  - local: Supabase not configured — bets are kept in this browser only
 */
export async function getBetStorage(): Promise<{ storage: BetStorage; bets: Bet[]; signedIn: boolean }> {
  if (isDemoMode()) return { storage: "demo", bets: demoBets(), signedIn: false };
  const sb = await supabaseServer();
  if (!sb) return { storage: "local", bets: [], signedIn: false };
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { storage: "supabase", bets: [], signedIn: false };
  const { data } = await sb.from("bets").select("*").order("placed_at", { ascending: false }).limit(5000);
  return { storage: "supabase", bets: (data ?? []).map(rowToBet), signedIn: true };
}

export function rowToBet(r: Record<string, unknown>): Bet {
  return {
    id: String(r.id), placedAt: String(r.placed_at), settledAt: (r.settled_at as string) ?? null, sport: String(r.sport),
    eventLabel: String(r.event_label), market: String(r.market), selection: String(r.selection),
    bookmaker: String(r.bookmaker_label ?? r.bookmaker_id ?? ""), odds: Number(r.odds), stake: Number(r.stake),
    closingOdds: r.closing_odds == null ? null : Number(r.closing_odds), status: r.status as Bet["status"],
    cashoutReturn: r.status === "cashed_out" && r.profit != null ? Number(r.profit) + Number(r.stake) : null, notes: (r.notes as string) ?? null,
  };
}
