import { clv as clvFn } from "@/lib/finance/clv";
import type { BetRecord } from "@/lib/finance/metrics";
import { getContext, getResolvedRange } from "@/lib/server/context";
import { buildAnalytics, loadAnalyticsBase } from "@/lib/server/analytics";
import { ClvView } from "@/components/analytics/clv";

export const metadata = { title: "CLV Intelligence" };

export default async function ClvPage() {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const base = await loadAnalyticsBase(ctx);
  const a = buildAnalytics(ctx, base, range);
  const missing = base.rows.filter((b) => b.status !== "pending" && b.kind === "single" && b.closing_odds == null).slice(0, 200).map((b) => ({
    id: b.id, ref: b.ref, event: b.event_name, selection: b.selection, odds: Number(b.odds), placed_at: b.placed_at, bookmaker: b.bookmakers?.name ?? null,
  }));
  const ref = ctx.bookmakers.find((b) => b.id === ctx.settings.clv_reference_bookmaker)?.name ?? null;
  const records = a.clvPoints.length ? base.conv.records.filter((r) => a.clvPoints.some((p) => p.id === r.id)) : [];
  const byLeague = groupClv(records, (r) => r.league ?? "—", a.convention);
  const byStrategy = groupClv(records, (r) => r.strategy ?? "No strategy", a.convention);
  return <ClvView a={a} rangeLabel={setting.label} missing={missing} reference={ref} byLeague={byLeague} byStrategy={byStrategy}
    movement={records.map((r) => ({ id: r.id, opening: r.openingOdds, taken: r.odds, closing: r.closingOdds }))} />;
}

function groupClv(rs: BetRecord[], key: (r: BetRecord) => string, conv: "odds" | "probability") {
  const m = new Map<string, number[]>();
  for (const r of rs) { const v = clvFn(r.odds, r.closingOdds, conv, r.side); if (v == null) continue; (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(v); }
  return [...m.entries()].map(([k, v]) => ({ key: k, clv: v.reduce((a, b) => a + b, 0) / v.length, n: v.length, positive: v.filter((x) => x > 0).length / v.length })).sort((a, b) => b.clv - a.clv);
}
