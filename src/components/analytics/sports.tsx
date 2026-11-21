"use client";
import * as React from "react";
import type { Analytics } from "@/lib/server/analytics";
import type { GroupRow } from "@/lib/finance/metrics";
import { KV, Kpi, Notice, PageHeader, Panel, toneOf } from "@/components/app/primitives";
import { CategoryBars, ReliabilityChart } from "@/components/charts/charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { GroupTable } from "./group-table";
import { fmtMoney, fmtNum, fmtOdds, fmtPct, fmtPp } from "@/lib/format";
import { cn } from "@/lib/utils";

type SportStats = { bets: number; settled: number; profit: number; stake: number; roi: number | null; winRate: number | null; avgOdds: number | null; clv: number | null; clvSample: number; maxDd: number; byLeague: GroupRow[]; byMarket: GroupRow[]; byLive: GroupRow[]; byBookmaker: GroupRow[] };

export function SportsView({ a, rangeLabel, perSport }: { a: Analytics; rangeLabel: string; perSport: Record<string, SportStats> }) {
  const sports = Object.keys(perSport).sort((x, y) => perSport[y]!.bets - perSport[x]!.bets);
  const [sel, setSel] = React.useState(sports[0] ?? "");
  const s = perSport[sel];
  const c = a.currency;
  const cal = a.calibration;
  const fmtClv = (v: number | null) => (a.convention === "odds" ? fmtPct(v, 2, true) : fmtPp(v));
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Sports Analytics" description={`${rangeLabel} · per-sport performance and probability calibration`} />
      <Tabs defaultValue="sports">
        <TabsList><TabsTrigger value="sports">Sports</TabsTrigger><TabsTrigger value="calibration">Probability calibration</TabsTrigger></TabsList>
        <TabsContent value="sports" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title="Profit by sport"><CategoryBars data={a.bySport} valueKey="profit" name="Profit" ccy={c} /></Panel>
            <Panel title="ROI by sport"><CategoryBars data={a.bySport} valueKey="roi" name="ROI" format="pct" /></Panel>
          </div>
          {sports.length === 0 ? <Notice>No bets in this period.</Notice> : (
            <>
              <div className="flex flex-wrap gap-1">{sports.map((x) => (
                <button key={x} onClick={() => setSel(x)} className={cn("rounded-[3px] border px-2.5 py-1 text-xs", sel === x ? "border-accent bg-accent-soft text-fg" : "border-line-strong text-muted hover:text-fg")}>{x} <span className="num text-dim">{perSport[x]!.bets}</span></button>
              ))}</div>
              {s && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                    <Kpi label="Bets" value={fmtNum(s.bets)} sub={`${s.settled} settled`} />
                    <Kpi label="Stake" value={fmtMoney(s.stake, c)} />
                    <Kpi label="P/L" value={fmtMoney(s.profit, c, true)} tone={toneOf(s.profit)} />
                    <Kpi label="ROI" value={fmtPct(s.roi, 2, true)} tone={toneOf(s.roi)} />
                    <Kpi label="Win rate" value={fmtPct(s.winRate)} />
                    <Kpi label="Avg odds" value={fmtOdds(s.avgOdds)} />
                    <Kpi label="CLV" value={fmtClv(s.clv)} sub={`n=${s.clvSample}`} tone={toneOf(s.clv)} />
                    <Kpi label="Max drawdown" value={fmtMoney(-s.maxDd, c)} tone={s.maxDd ? "down" : "neutral"} />
                  </div>
                  <Panel title={`${sel} breakdowns`}>
                    <Tabs defaultValue="league" className="p-2">
                      <TabsList><TabsTrigger value="league">League</TabsTrigger><TabsTrigger value="market">Market</TabsTrigger><TabsTrigger value="timing">Pre-match / live</TabsTrigger><TabsTrigger value="book">Bookmaker</TabsTrigger></TabsList>
                      <TabsContent value="league"><GroupTable rows={s.byLeague} ccy={c} label="League" convention={a.convention} /></TabsContent>
                      <TabsContent value="market"><GroupTable rows={s.byMarket} ccy={c} label="Market" convention={a.convention} /></TabsContent>
                      <TabsContent value="timing"><GroupTable rows={s.byLive} ccy={c} label="Timing" convention={a.convention} /></TabsContent>
                      <TabsContent value="book"><GroupTable rows={s.byBookmaker} ccy={c} label="Bookmaker" convention={a.convention} /></TabsContent>
                    </Tabs>
                  </Panel>
                </>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="calibration" className="flex flex-col gap-3">
          <Notice level={cal.lowSample ? "warn" : "info"}>
            Uses only settled back bets with an estimated probability and a clean won/lost result ({fmtNum(cal.sample)} bets; {fmtNum(cal.excluded)} with half results, voids or cash-outs excluded).
            {cal.lowSample && " Fewer than 50 bets: calibration is not yet meaningful — note the wide confidence intervals."}
          </Notice>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Sample" value={fmtNum(cal.sample)} />
            <Kpi label="Brier score" value={cal.brier?.toFixed(4) ?? "—"} sub="lower is better" />
            <Kpi label="Market Brier" value={cal.marketBrier?.toFixed(4) ?? "—"} sub="1/odds on same bets" />
            <Kpi label="Brier skill vs market" value={fmtPct(cal.brierSkill, 1, true)} tone={toneOf(cal.brierSkill)} />
            <Kpi label="Log loss" value={cal.logLoss?.toFixed(4) ?? "—"} />
            <Kpi label="Predicted vs actual" value={`${fmtPct(cal.meanPredicted)} / ${fmtPct(cal.actualRate)}`} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title="Reliability diagram" subtitle="actual win rate per bucket with 95% Wilson intervals; diagonal = perfect calibration"><ReliabilityChart buckets={cal.buckets} /></Panel>
            <Panel title="Calibration buckets">
              <table className="w-full text-xs"><thead className="bg-panel-2"><tr>{["Bucket", "Bets", "Predicted", "Actual", "95% CI", "Gap"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
                <tbody>{cal.buckets.map((b) => (
                  <tr key={b.label} className={cn("border-b border-line/60", !b.n && "text-dim")}>
                    <td className="num h-7 px-2">{b.label}</td><td className="num px-2">{b.n}</td><td className="num px-2">{fmtPct(b.meanPredicted)}</td><td className="num px-2">{fmtPct(b.actualRate)}</td>
                    <td className="num px-2">{b.ciLow != null ? `${fmtPct(b.ciLow, 0)}–${fmtPct(b.ciHigh, 0)}` : "—"}</td>
                    <td className="num px-2">{b.actualRate != null && b.meanPredicted != null ? fmtPp(b.actualRate - b.meanPredicted, 1) : "—"}</td>
                  </tr>
                ))}</tbody></table>
            </Panel>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {([["By sport", a.calibrationBySport], ["By market", a.calibrationByMarket]] as const).map(([t, rows]) => (
              <Panel key={t} title={`Calibration ${t.toLowerCase()}`}>
                <table className="w-full text-xs"><thead className="bg-panel-2"><tr>{["", "n", "Brier", "Market", "Skill", "Log loss", "Pred / actual"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.key} className="border-b border-line/60"><td className="h-7 px-2">{r.key}</td><td className="num px-2">{r.sample}</td><td className="num px-2">{r.brier?.toFixed(4)}</td><td className="num px-2">{r.marketBrier?.toFixed(4)}</td>
                      <td className={cn("num px-2", (r.brierSkill ?? 0) > 0 ? "text-up" : "text-down")}>{fmtPct(r.brierSkill, 1, true)}</td><td className="num px-2">{r.logLoss?.toFixed(4)}</td><td className="num px-2">{fmtPct(r.meanPredicted)} / {fmtPct(r.actualRate)}</td></tr>
                  ))}{!rows.length && <tr><td colSpan={7} className="py-6 text-center text-dim">No bets with probability estimates</td></tr>}</tbody></table>
              </Panel>
            ))}
          </div>
          <Panel title="How to read this" bodyClassName="p-3 text-xs text-muted">
            <KV k="Brier score" v="mean (p − outcome)²; 0.25 = coin-flip guessing at 50%" />
            <KV k="Brier skill" v="1 − your Brier / market Brier; > 0 means your probabilities beat the prices you took" />
            <KV k="Log loss" v="penalises confident mistakes heavily" />
            <KV k="Buckets" v="points inside the CI band of the diagonal are consistent with good calibration" />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
