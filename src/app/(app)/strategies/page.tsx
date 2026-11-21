import { getContext, getResolvedRange } from "@/lib/server/context";
import { loadAnalyticsBase } from "@/lib/server/analytics";
import { bySettlement, inRange, summarize } from "@/lib/finance/metrics";
import { StrategiesView } from "@/components/tools/strategies";

export const metadata = { title: "Strategy Manager" };

export default async function StrategiesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const base = await loadAnalyticsBase(ctx);
  const conv = ctx.settings.clv_convention;
  const bets = base.conv.records.filter((b) => inRange(b, range));
  const names = [...ctx.strategies.map((s) => s.name), "No strategy"];
  const stats = Object.fromEntries(names.map((n) => {
    const list = bets.filter((b) => (b.strategy ?? "No strategy") === n);
    const s = summarize(list, { convention: conv });
    return [n, { bets: s.totalBets, settled: s.settledBets, stake: s.totalStake, profit: s.netProfit, roi: s.roi, yield: s.yield, winRate: s.winRate, avgOdds: s.averageOdds,
      clv: s.averageClv, clvSample: s.clvSample, maxDd: s.drawdown.maxAmount, sharpe: s.sharpe, evRoi: s.expectedRoi, pending: s.pendingBets }];
  }));
  // Comparison curves on a shared daily axis.
  const days = new Map<string, Record<string, number | string>>();
  const totals: Record<string, number> = {};
  for (const b of bySettlement(bets)) {
    const k = (b.settledAt ?? b.placedAt).slice(0, 10);
    const n = b.strategy ?? "No strategy";
    totals[n] = (totals[n] ?? 0) + (b.profit ?? 0);
    days.set(k, { ...(days.get(k) ?? { at: k }), ...Object.fromEntries(Object.entries(totals).map(([x, v]) => [x, Math.round(v * 100) / 100])) });
  }
  const strategies = ctx.strategies.map((s) => ({
    id: s.id, name: s.name, description: s.description, sport_id: s.sport_id, market_type_id: s.market_type_id, entry_conditions: s.entry_conditions,
    min_odds: s.min_odds == null ? null : Number(s.min_odds), max_odds: s.max_odds == null ? null : Number(s.max_odds),
    est_probability: s.est_probability == null ? null : Number(s.est_probability), stake_rule: s.stake_rule as { type: string; value: number }, color: s.color, is_active: s.is_active,
  }));
  return <StrategiesView strategies={strategies} stats={stats} curve={[...days.values()]} currency={ctx.displayCurrency} convention={conv} rangeLabel={setting.label} focus={(await searchParams).id} />;
}
