import "server-only";
import type { AppContext } from "./context";
import type { BetRecord } from "@/lib/finance/metrics";
import { summarize } from "@/lib/finance/metrics";

export interface GoalProgress { id: string; name: string; metric: string; target: number; current: number | null; progress: number | null; periodStart: string; periodEnd: string; achieved: boolean }

/** Progress of each goal from stored bets in its own period (not the global date filter). */
export async function goalProgress(ctx: AppContext, records: BetRecord[], equity: number): Promise<GoalProgress[]> {
  const { data } = await ctx.sb.from("goals").select("*").eq("is_demo", ctx.isDemo).order("period_end");
  return (data ?? []).map((g) => {
    const lo = Date.parse(g.period_start), hi = Date.parse(g.period_end) + 86_400_000;
    const list = records.filter((b) => { const t = Date.parse(b.placedAt); return t >= lo && t < hi; });
    const s = summarize(list, { convention: ctx.settings.clv_convention });
    const current = g.metric === "profit" ? s.netProfit : g.metric === "roi" ? s.roi : g.metric === "bankroll" ? equity : g.metric === "clv" ? s.averageClv : g.metric === "bets" ? s.settledBets : s.winRate;
    const target = Number(g.target);
    return { id: g.id, name: g.name, metric: g.metric, target, current, progress: current == null || target === 0 ? null : current / target, periodStart: g.period_start, periodEnd: g.period_end, achieved: current != null && current >= target };
  });
}
