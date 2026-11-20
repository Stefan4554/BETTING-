import { getContext } from "@/lib/server/context";
import { loadAnalyticsBase } from "@/lib/server/analytics";
import { loadRiskLimits } from "@/lib/server/data";
import { checkLimits, riskState } from "@/lib/finance/risk";
import { summarize } from "@/lib/finance/metrics";
import { RiskView } from "@/components/tools/risk";

export const metadata = { title: "Risk Management" };

export default async function RiskPage() {
  const ctx = await getContext();
  const [base, limits] = await Promise.all([loadAnalyticsBase(ctx), loadRiskLimits(ctx)]);
  const state = riskState(base.conv.records, base.tradeExp, base.totals.equity);
  const dd = summarize(base.conv.records, { capital: base.capital }).drawdown;
  const n = (v: unknown) => (v == null ? null : Number(v));
  const L = {
    maxStakePerBet: n(limits?.max_stake_per_bet), maxBetPctBankroll: n(limits?.max_bet_pct_bankroll), maxEventExposure: n(limits?.max_event_exposure),
    maxTotalExposurePct: n(limits?.max_total_exposure_pct), maxDailyLoss: n(limits?.max_daily_loss), maxWeeklyLoss: n(limits?.max_weekly_loss),
    maxDrawdownPct: n(limits?.max_drawdown_pct), maxCorrelatedExposure: n(limits?.max_correlated_exposure),
  };
  const breaches = checkLimits(state, L, { equity: base.totals.equity, drawdownPct: dd.currentPct });
  const bankrollName = Object.fromEntries(ctx.bankrolls.map((b) => [b.id, b.name]));
  const largest = base.conv.records.filter((b) => b.status === "pending").sort((a, b) => b.liability - a.liability).slice(0, 25)
    .map((b) => ({ id: b.id, ref: b.ref, event: b.eventName, selection: b.selection ?? "", market: b.market, liability: b.liability, group: b.correlationGroup, book: b.bookmaker, pct: base.totals.equity ? b.liability / base.totals.equity : null }));
  const { data: alerts } = await ctx.sb.from("alerts").select("*").eq("is_demo", ctx.isDemo).in("type", ["daily_loss", "weekly_loss", "drawdown", "exposure", "stake_limit"]).order("created_at", { ascending: false }).limit(20);
  return <RiskView state={{ ...state, byBankroll: state.byBankroll.map((r) => ({ ...r, key: bankrollName[r.key] ?? r.key })) }} limits={L} enforce={limits?.enforce ?? false}
    breaches={breaches} drawdown={dd} equity={base.totals.equity} currency={ctx.displayCurrency} largest={largest} alerts={alerts ?? []} />;
}
