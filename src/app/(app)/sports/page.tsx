import { getContext, getResolvedRange } from "@/lib/server/context";
import { buildAnalytics, loadAnalyticsBase } from "@/lib/server/analytics";
import { SportsView } from "@/components/analytics/sports";
import { groupBy, inRange, summarize } from "@/lib/finance/metrics";

export const metadata = { title: "Sports Analytics" };

export default async function SportsPage() {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const base = await loadAnalyticsBase(ctx);
  const a = buildAnalytics(ctx, base, range);
  const conv = ctx.settings.clv_convention;
  const bets = base.conv.records.filter((b) => inRange(b, range));
  const sports = [...new Set(bets.map((b) => b.sport))];
  const perSport = Object.fromEntries(sports.map((s) => {
    const list = bets.filter((b) => b.sport === s);
    const sum = summarize(list, { convention: conv });
    return [s, {
      bets: sum.totalBets, settled: sum.settledBets, profit: sum.netProfit, stake: sum.totalStake, roi: sum.roi, winRate: sum.winRate, avgOdds: sum.averageOdds,
      clv: sum.averageClv, clvSample: sum.clvSample, maxDd: sum.drawdown.maxAmount,
      byLeague: groupBy(list, (b) => b.league ?? "—", conv), byMarket: groupBy(list, (b) => b.market, conv),
      byLive: groupBy(list, (b) => (b.isLive ? "Live" : "Pre-match"), conv), byBookmaker: groupBy(list, (b) => b.bookmaker ?? "—", conv),
    }];
  }));
  return <SportsView a={a} rangeLabel={setting.label} perSport={perSport} />;
}
