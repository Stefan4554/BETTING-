"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck, XOctagon } from "lucide-react";
import type { Breach, RiskLimits, RiskState } from "@/lib/finance/risk";
import type { Drawdown } from "@/lib/finance/metrics";
import { Kpi, Money, PageHeader, Panel, toneOf } from "@/components/app/primitives";
import { CategoryBars } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { saveRiskLimits } from "@/app/actions/finance";
import { fmtAgo, fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RiskView({ state, limits, enforce, breaches, drawdown, equity, currency: c, largest, alerts }: {
  state: RiskState; limits: RiskLimits; enforce: boolean; breaches: Breach[]; drawdown: Drawdown; equity: number; currency: string;
  largest: { id: string; ref?: number; event: string; selection: string; market: string; liability: number; group: string | null; book: string | null; pct: number | null }[];
  alerts: { id: string; title: string; body: string | null; severity: string; created_at: string }[];
}) {
  const router = useRouter();
  const pct = (v: number | null | undefined) => (v == null ? "" : String(+(v * 100).toFixed(3)));
  const [f, setF] = React.useState({
    max_stake_per_bet: limits.maxStakePerBet?.toString() ?? "", max_bet_pct_bankroll: pct(limits.maxBetPctBankroll), max_event_exposure: limits.maxEventExposure?.toString() ?? "",
    max_total_exposure_pct: pct(limits.maxTotalExposurePct), max_daily_loss: limits.maxDailyLoss?.toString() ?? "", max_weekly_loss: limits.maxWeeklyLoss?.toString() ?? "",
    max_drawdown_pct: pct(limits.maxDrawdownPct), max_correlated_exposure: limits.maxCorrelatedExposure?.toString() ?? "", enforce,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const p = (s: string) => (s.trim() ? Number(s) / 100 : undefined);
    const v = (s: string) => (s.trim() ? Number(s) : undefined);
    const r = await saveRiskLimits({
      max_stake_per_bet: v(f.max_stake_per_bet), max_bet_pct_bankroll: p(f.max_bet_pct_bankroll), max_event_exposure: v(f.max_event_exposure),
      max_total_exposure_pct: p(f.max_total_exposure_pct), max_daily_loss: v(f.max_daily_loss), max_weekly_loss: v(f.max_weekly_loss),
      max_drawdown_pct: p(f.max_drawdown_pct), max_correlated_exposure: v(f.max_correlated_exposure), enforce: f.enforce,
    });
    if (!r.ok) toast.error(r.error); else { toast.success("Risk limits saved and evaluated"); router.refresh(); }
  };
  const status = breaches.some((b) => b.severity === "critical") ? "critical" : breaches.length ? "warning" : "ok";
  const usage = (v: number, l: number | null | undefined) => (l ? Math.min(1.5, v / l) : null);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Risk Management" description={`All amounts in ${c}. Positions are not assumed independent: same-event and correlation-group exposures are summed.`} />
      <div className={cn("flex items-center gap-2 rounded-[3px] border px-3 py-2 text-xs", status === "ok" && "border-up/30 bg-up-soft text-up", status === "warning" && "border-warn/30 bg-warn-soft text-warn", status === "critical" && "border-down/40 bg-down-soft text-down")}>
        {status === "ok" ? <ShieldCheck className="h-4 w-4" /> : status === "warning" ? <AlertTriangle className="h-4 w-4" /> : <XOctagon className="h-4 w-4" />}
        <b>{status === "ok" ? "Within all limits" : status === "warning" ? "Approaching limits" : "Limits exceeded"}</b>
        {breaches.length > 0 && <span>— {breaches.map((b) => `${b.message} (${b.type === "drawdown" ? fmtPct(b.value) : fmtMoney(b.value, c)} / ${b.type === "drawdown" ? fmtPct(b.limit) : fmtMoney(b.limit, c)})`).join(" · ")}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Total open exposure" value={fmtMoney(state.totalExposure, c)} sub={`${fmtPct(state.exposurePctOfBankroll)} of bankroll`} tone={state.totalExposure ? "warn" : "neutral"} />
        <Kpi label="Bets / trades" value={`${fmtMoney(state.betExposure, c)}`} sub={`trades ${fmtMoney(state.tradeExposure, c)}`} />
        <Kpi label="Bankroll (equity)" value={fmtMoney(equity, c)} />
        <Kpi label="Today P/L" value={fmtMoney(state.dailyPnl, c, true)} tone={toneOf(state.dailyPnl)} sub={limits.maxDailyLoss ? `limit −${fmtMoney(limits.maxDailyLoss, c)}` : "no limit"} />
        <Kpi label="This week P/L" value={fmtMoney(state.weeklyPnl, c, true)} tone={toneOf(state.weeklyPnl)} sub={limits.maxWeeklyLoss ? `limit −${fmtMoney(limits.maxWeeklyLoss, c)}` : "no limit"} />
        <Kpi label="Current drawdown" value={fmtPct(drawdown.currentPct)} sub={fmtMoney(-drawdown.currentAmount, c)} tone={drawdown.currentAmount ? "down" : "neutral"} />
        <Kpi label="Max drawdown" value={fmtPct(drawdown.maxPct)} sub={fmtMoney(-drawdown.maxAmount, c)} />
        <Kpi label="Concentration" value={fmtPct(state.concentration)} sub={`largest event · HHI ${state.hhi?.toFixed(2) ?? "—"}`} tone={(state.concentration ?? 0) > 0.4 ? "warn" : "neutral"} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="Risk limits" subtitle={f.enforce ? "ENFORCED — breaching bets are rejected by the database" : "alert-only"} bodyClassName="grid grid-cols-2 gap-2 p-3">
          <Label>Max stake per bet ({c})<Input inputMode="decimal" value={f.max_stake_per_bet} onChange={set("max_stake_per_bet")} /></Label>
          <Label>Max % bankroll per bet<Input inputMode="decimal" value={f.max_bet_pct_bankroll} onChange={set("max_bet_pct_bankroll")} /></Label>
          <Label>Max exposure per event<Input inputMode="decimal" value={f.max_event_exposure} onChange={set("max_event_exposure")} /></Label>
          <Label>Max total exposure %<Input inputMode="decimal" value={f.max_total_exposure_pct} onChange={set("max_total_exposure_pct")} /></Label>
          <Label>Max daily loss<Input inputMode="decimal" value={f.max_daily_loss} onChange={set("max_daily_loss")} /></Label>
          <Label>Max weekly loss<Input inputMode="decimal" value={f.max_weekly_loss} onChange={set("max_weekly_loss")} /></Label>
          <Label>Max drawdown %<Input inputMode="decimal" value={f.max_drawdown_pct} onChange={set("max_drawdown_pct")} /></Label>
          <Label>Max per correlation group<Input inputMode="decimal" value={f.max_correlated_exposure} onChange={set("max_correlated_exposure")} /></Label>
          <label className="col-span-2 flex items-center gap-1.5 text-xs"><Checkbox checked={f.enforce} onChange={(e) => setF({ ...f, enforce: e.target.checked })} /> Enforce per-bet limits (stake, % bankroll, event & total exposure) at placement</label>
          <p className="col-span-2 text-[11px] text-dim">Stake limits apply to the amount reserved in bankroll currency (liability for lays). Daily/weekly loss and drawdown generate alerts. Exposure limits use the per-bankroll currency for enforcement.</p>
          <Button className="col-span-2" onClick={save}>Save & evaluate</Button>
        </Panel>
        <Panel title="Exposure breakdown" className="xl:col-span-2">
          <Tabs defaultValue="event" className="p-2">
            <TabsList>{[["event", "Event"], ["sport", "Sport"], ["league", "League"], ["market", "Market"], ["bookmaker", "Bookmaker"], ["bankroll", "Bankroll"], ["group", "Correlation group"]].map(([k, l]) => <TabsTrigger key={k} value={k!}>{l}</TabsTrigger>)}</TabsList>
            {([["event", state.byEvent, limits.maxEventExposure], ["sport", state.bySport, null], ["league", state.byLeague, null], ["market", state.byMarket, null], ["bookmaker", state.byBookmaker, null], ["bankroll", state.byBankroll, null], ["group", state.byCorrelationGroup, limits.maxCorrelatedExposure]] as const).map(([k, rows, lim]) => (
              <TabsContent key={k} value={k}>
                {rows.length ? <>
                  <CategoryBars data={rows.slice(0, 15)} valueKey="exposure" name="Exposure" ccy={c} signed={false} color="var(--warn)" />
                  <table className="mt-2 w-full text-xs"><thead className="bg-panel-2"><tr>{["", "Positions", "Exposure", "Share", lim ? "Limit use" : ""].map((h, i) => <th key={i} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
                    <tbody>{rows.map((r) => { const u = usage(r.exposure, lim); return (
                      <tr key={r.key} className="border-b border-line/60"><td className="h-7 px-2">{r.key}</td><td className="num px-2">{r.bets}</td><td className="px-2"><Money value={r.exposure} ccy={c} /></td><td className="num px-2">{fmtPct(r.share)}</td>
                        <td className="px-2">{u != null && <div className="flex items-center gap-1.5"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-raised"><div className={cn("h-full", u > 1 ? "bg-down" : u >= 0.8 ? "bg-warn" : "bg-up")} style={{ width: `${Math.min(100, u * 100)}%` }} /></div><span className="num">{fmtPct(u, 0)}</span></div>}</td></tr>
                    ); })}</tbody></table>
                </> : <p className="py-8 text-center text-xs text-dim">{k === "group" ? "No open bets with a correlation group. Tag related bets (same matchday, same team, parlays of correlated legs) in the bet form." : "No open exposure."}</p>}
              </TabsContent>
            ))}
          </Tabs>
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Largest open positions">
          <table className="w-full text-xs"><thead className="bg-panel-2"><tr>{["#", "Event", "Selection", "Book", "Group", "At risk", "% bankroll"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{largest.map((b) => (
              <tr key={b.id} className="border-b border-line/60"><td className="num h-7 px-2 text-dim">{b.ref}</td><td className="max-w-[200px] truncate px-2">{b.event}</td><td className="max-w-[140px] truncate px-2">{b.selection}</td><td className="px-2 text-muted">{b.book ?? "—"}</td><td className="px-2 text-muted">{b.group ?? ""}</td><td className="px-2"><Money value={b.liability} ccy={c} /></td><td className="num px-2">{fmtPct(b.pct)}</td></tr>
            ))}{!largest.length && <tr><td colSpan={7} className="py-6 text-center text-dim">No open positions</td></tr>}</tbody></table>
        </Panel>
        <Panel title="Recent risk alerts">
          {alerts.length ? alerts.map((a) => (
            <div key={a.id} className="flex items-start gap-2 border-b border-line/60 px-3 py-2 text-xs">
              <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", a.severity === "critical" ? "bg-down" : a.severity === "warning" ? "bg-warn" : "bg-accent")} />
              <div className="flex-1"><div>{a.title}</div>{a.body && <div className="text-muted">{a.body}</div>}</div><span className="text-dim">{fmtAgo(a.created_at)}</span>
            </div>
          )) : <p className="p-6 text-center text-xs text-dim">No risk alerts.</p>}
        </Panel>
      </div>
    </div>
  );
}
