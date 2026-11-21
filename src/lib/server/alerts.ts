import "server-only";
import type { AppContext } from "./context";
import { loadAnalyticsBase } from "./analytics";
import { loadRiskLimits } from "./data";
import { checkLimits, riskState } from "@/lib/finance/risk";
import { summarize } from "@/lib/finance/metrics";
import { fmtMoney, fmtPct } from "@/lib/format";
import { goalProgress } from "./goals";

/**
 * Evaluate risk limits after a financial change and raise in-app alerts.
 * Dedupe keys include the day, so the same breach alerts at most once per day.
 */
export async function evaluateRiskAlerts(ctx: AppContext) {
  const limits = await loadRiskLimits(ctx);
  if (!limits) return 0;
  const base = await loadAnalyticsBase(ctx);
  const state = riskState(base.conv.records, base.tradeExp, base.totals.equity);
  const dd = summarize(base.conv.records, { capital: base.capital }).drawdown;
  const breaches = checkLimits(state, {
    maxEventExposure: num(limits.max_event_exposure), maxTotalExposurePct: num(limits.max_total_exposure_pct),
    maxDailyLoss: num(limits.max_daily_loss), maxWeeklyLoss: num(limits.max_weekly_loss), maxDrawdownPct: num(limits.max_drawdown_pct),
    maxCorrelatedExposure: num(limits.max_correlated_exposure),
  }, { equity: base.totals.equity, drawdownPct: dd.currentPct });
  const goals = await goalProgress(ctx, base.conv.records, base.totals.equity).catch(() => []);
  const goalRows = goals.filter((g) => g.achieved).map((g) => ({
    user_id: ctx.user.id, is_demo: ctx.isDemo, type: "goal_progress", severity: "info" as const, title: `Goal reached: ${g.name}`,
    body: `${g.metric} target ${g.target} reached (${g.periodStart} → ${g.periodEnd})`, data: { goal_id: g.id }, dedupe_key: `goal:${g.id}`,
  }));
  if (goalRows.length) await ctx.sb.from("alerts").upsert(goalRows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (!breaches.length) return goalRows.length;
  const day = new Date().toISOString().slice(0, 10);
  const ccy = ctx.displayCurrency;
  const rows = breaches.map((b) => ({
    user_id: ctx.user.id, is_demo: ctx.isDemo,
    type: b.type === "stake_limit" ? "stake_limit" : b.type === "drawdown" ? "drawdown" : b.type,
    severity: b.severity,
    title: `${b.severity === "critical" ? "Limit exceeded" : "Approaching limit"}: ${b.message}`,
    body: b.type === "drawdown"
      ? `${fmtPct(b.value)} of ${fmtPct(b.limit)} allowed`
      : `${fmtMoney(b.value, ccy)} of ${fmtMoney(b.limit, ccy)} allowed`,
    data: { key: b.key, value: b.value, limit: b.limit },
    dedupe_key: `${b.type}:${b.key}:${b.severity}:${day}:${ctx.isDemo ? "d" : "l"}`,
  }));
  const { error } = await ctx.sb.from("alerts").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  return error ? 0 : rows.length;
}

const num = (v: unknown) => (v == null ? null : Number(v));
