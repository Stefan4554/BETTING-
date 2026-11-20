"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, LayoutGrid } from "lucide-react";
import type { Analytics } from "@/lib/server/analytics";
import { Kpi, Notice, PageHeader, Panel, SampleWarning, toneOf } from "@/components/app/primitives";
import { CategoryBars, ChartTable, Histogram, SignedBars, TimeSeries } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/input";
import { updateSettings } from "@/app/actions/settings";
import { change } from "@/lib/finance/metrics";
import { fmtMoney, fmtNum, fmtOdds, fmtPct, fmtPp } from "@/lib/format";
import { useNewBet } from "@/components/app/app-data";
import type { GoalProgress } from "@/lib/server/goals";
import { GoalsPanel } from "./goals";

export const WIDGETS = [
  ["cum_pnl", "Cumulative P&L"], ["equity", "Bankroll equity curve"], ["daily", "Daily P&L"], ["weekly", "Weekly P&L"], ["monthly", "Monthly P&L"],
  ["roi", "ROI over time"], ["clv", "CLV over time"], ["winrate", "Win rate trend"], ["by_sport", "Profit by sport"], ["by_bookmaker", "Profit by bookmaker"],
  ["by_strategy", "Profit by strategy"], ["odds_dist", "Odds distribution"], ["stake_dist", "Stake distribution"], ["exposure", "Risk exposure"], ["goals", "Goals"],
] as const;
type WidgetId = (typeof WIDGETS)[number][0];

export function DashboardView({ a, widgets, rangeLabel, hasPrevious, goals }: { a: Analytics; widgets: string[]; rangeLabel: string; hasPrevious: boolean; goals: GoalProgress[] }) {
  const s = a.summary, p = a.previous, c = a.currency;
  const [custom, setCustom] = React.useState(false);
  const newBet = useNewBet();
  const order: WidgetId[] = (widgets.length ? widgets.filter((w) => WIDGETS.some(([k]) => k === w)) : WIDGETS.map(([k]) => k)) as WidgetId[];
  const d = (cur: number | null, prev: number | null | undefined, invert = false) => (hasPrevious ? { value: change(cur, prev ?? null), invert } : null);
  const clvFmt = (x: number | null) => (a.convention === "odds" ? fmtPct(x, 2, true) : fmtPp(x));

  if (s.totalBets === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Overview" description={rangeLabel} />
        <Panel><div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm">No bets in this period.</p>
          <p className="max-w-md text-xs text-muted">Every number on this dashboard is computed from your stored bets. Add a bet, import a CSV, change the date filter, or switch to the DEMO workspace to explore with simulated data.</p>
          <div className="mt-2 flex gap-2"><Button onClick={() => newBet.open()}>Add first bet</Button><Button variant="outline" onClick={() => location.assign("/bets?import=1")}>Import CSV</Button></div>
        </div></Panel>
      </div>
    );
  }

  const exposureRows = a.risk.bySport.map((r) => ({ key: r.key, exposure: r.exposure }));
  const widget: Record<WidgetId, React.ReactNode> = {
    cum_pnl: <Panel title="Cumulative P&L" subtitle={c}><TimeSeries data={a.curve} series={[{ key: "cumProfit", name: "Cumulative P&L" }]} area ccy={c} /></Panel>,
    equity: <Panel title="Bankroll equity curve" subtitle="net capital + cumulative betting P&L"><TimeSeries data={a.curve} series={[{ key: "equity", name: "Equity", color: "var(--s1)" }]} ccy={c} zeroLine={false} /></Panel>,
    daily: <Panel title="Daily P&L"><SignedBars data={a.daily.slice(-60)} xKey="period" yKey="profit" name="P&L" ccy={c} /><ChartTable rows={a.daily} columns={[{ key: "period", label: "Day" }, { key: "bets", label: "Bets", format: "int" }, { key: "profit", label: "P&L", format: "money", ccy: c }, { key: "roi", label: "ROI", format: "pct" }]} /></Panel>,
    weekly: <Panel title="Weekly P&L"><SignedBars data={a.weekly} xKey="period" yKey="profit" name="P&L" ccy={c} /></Panel>,
    monthly: <Panel title="Monthly P&L"><SignedBars data={a.monthly} xKey="period" yKey="profit" name="P&L" ccy={c} /><ChartTable rows={a.monthly} columns={[{ key: "period", label: "Month" }, { key: "bets", label: "Bets", format: "int" }, { key: "stake", label: "Stake", format: "money", ccy: c }, { key: "profit", label: "P&L", format: "money", ccy: c }, { key: "roi", label: "ROI", format: "pct" }]} /></Panel>,
    roi: <Panel title="ROI over time" subtitle="cumulative"><TimeSeries data={a.curve} series={[{ key: "roi", name: "ROI", color: "var(--s1)" }]} format="pct" /></Panel>,
    clv: <Panel title="CLV over time" subtitle={a.convention === "odds" ? "running avg · taken/closing − 1" : "running avg · pp"}>
      <TimeSeries data={a.curve.filter((x) => x.clv != null)} series={[{ key: "clv", name: "Avg CLV", color: "var(--s3)" }]} format={a.convention === "odds" ? "pct" : "pp"} /></Panel>,
    winrate: <Panel title="Win rate trend" subtitle="cumulative, voids excluded"><TimeSeries data={a.curve} series={[{ key: "winRate", name: "Win rate", color: "var(--s7)" }]} format="pct" zeroLine={false} /></Panel>,
    by_sport: <Panel title="Profit by sport"><CategoryBars data={a.bySport} valueKey="profit" name="Profit" ccy={c} /></Panel>,
    by_bookmaker: <Panel title="Profit by bookmaker"><CategoryBars data={a.byBookmaker.slice(0, 12)} valueKey="profit" name="Profit" ccy={c} /></Panel>,
    by_strategy: <Panel title="Profit by strategy"><CategoryBars data={a.byStrategy} valueKey="profit" name="Profit" ccy={c} /></Panel>,
    odds_dist: <Panel title="Odds distribution" subtitle="settled bets"><Histogram data={a.byOdds.map((r) => ({ key: r.key, count: r.settled }))} /></Panel>,
    stake_dist: <Panel title="Stake distribution" subtitle={`quartile buckets, ${c}`}><Histogram data={a.byStake.map((r) => ({ key: r.key, count: r.bets }))} /></Panel>,
    exposure: <Panel title="Risk exposure" subtitle={`open ${fmtMoney(a.risk.totalExposure, c)}`}>
      {exposureRows.length ? <CategoryBars data={exposureRows} valueKey="exposure" name="Open exposure" ccy={c} signed={false} color="var(--warn)" /> : <p className="p-6 text-center text-xs text-dim">No open positions</p>}</Panel>,
    goals: <GoalsPanel goals={goals} currency={c} convention={a.convention} />,
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Overview" description={`${rangeLabel}${hasPrevious ? " · deltas vs previous period" : ""} · amounts in ${c}`}
        actions={<Button variant="outline" onClick={() => setCustom(true)}><LayoutGrid className="h-3.5 w-3.5" /> Customize</Button>} />
      {a.unconverted > 0 && <Notice level="warn">{a.unconverted} bet(s) excluded: no exchange rate to {c}. Add rates in Settings → Currencies.</Notice>}
      <SampleWarning n={s.settledBets} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Total bets" value={fmtNum(s.totalBets)} delta={d(s.totalBets, p?.totalBets)} />
        <Kpi label="Settled" value={fmtNum(s.settledBets)} sub={`${s.voidBets} void`} />
        <Kpi label="Pending" value={fmtNum(s.pendingBets)} sub={fmtMoney(s.pendingStake, c)} />
        <Kpi label="Total stake" value={fmtMoney(s.totalStake, c)} delta={d(s.totalStake, p?.totalStake)} />
        <Kpi label="Net P/L" value={fmtMoney(s.netProfit, c, true)} tone={toneOf(s.netProfit)} delta={d(s.netProfit, p?.netProfit)} />
        <Kpi label="Current bankroll" value={fmtMoney(a.equity, c)} sub={`cash ${fmtMoney(a.balance, c)}`} hint="Cash balance + stakes reserved by pending bets, all bankrolls" />
        <Kpi label="ROI" value={fmtPct(s.roi, 2, true)} tone={toneOf(s.roi)} delta={d(s.roi, p?.roi)} hint="Net profit / total settled stake" />
        <Kpi label="Yield" value={fmtPct(s.yield, 2, true)} tone={toneOf(s.yield)} hint="Defined identically to ROI: net profit / settled stake" />
        <Kpi label="Win rate" value={fmtPct(s.winRate)} sub={`${s.wins}W ${s.losses}L`} delta={d(s.winRate, p?.winRate)} />
        <Kpi label="Avg odds" value={fmtOdds(s.averageOdds)} />
        <Kpi label="CLV" value={clvFmt(s.averageClv)} tone={toneOf(s.averageClv)} sub={`n=${s.clvSample} · ${a.convention}`} hint={a.convention === "odds" ? "Average of taken/closing − 1" : "Average closing − entry implied probability"} />
        <Kpi label="Expected value" value={fmtMoney(s.expectedProfit, c, true)} sub={s.evSample ? `n=${s.evSample} · actual ${fmtPct(s.realizedRoiOnEvSample, 1, true)}` : "needs est. probability"} tone={toneOf(s.expectedProfit)} />
        <Kpi label="Max drawdown" value={fmtMoney(-s.drawdown.maxAmount, c)} sub={fmtPct(s.drawdown.maxPct)} tone={s.drawdown.maxAmount > 0 ? "down" : "neutral"} />
        <Kpi label="Open exposure" value={fmtMoney(a.risk.totalExposure, c)} sub={a.risk.exposurePctOfBankroll != null ? `${fmtPct(a.risk.exposurePctOfBankroll)} of bankroll` : undefined} tone={a.risk.totalExposure > 0 ? "warn" : "neutral"} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{order.map((k) => <React.Fragment key={k}>{widget[k]}</React.Fragment>)}</div>
      <Customize open={custom} onOpenChange={setCustom} current={order} />
    </div>
  );
}

function Customize({ open, onOpenChange, current }: { open: boolean; onOpenChange: (o: boolean) => void; current: WidgetId[] }) {
  const router = useRouter();
  const [list, setList] = React.useState<{ id: WidgetId; on: boolean }[]>([]);
  React.useEffect(() => {
    if (open) setList([...current.map((id) => ({ id, on: true })), ...WIDGETS.filter(([k]) => !current.includes(k)).map(([id]) => ({ id, on: false }))]);
  }, [open, current]);
  const move = (i: number, dir: -1 | 1) => setList((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const save = async () => {
    const r = await updateSettings({ dashboard_widgets: list.filter((x) => x.on).map((x) => x.id) });
    if (!r.ok) toast.error(r.error); else { toast.success("Dashboard saved"); onOpenChange(false); router.refresh(); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Customize dashboard" description="Choose and order widgets. KPI cards always show.">
        <div className="flex flex-col gap-1">
          {list.map((w, i) => (
            <div key={w.id} className="flex items-center gap-2 rounded-[3px] border border-line px-2 py-1 text-xs">
              <Checkbox checked={w.on} onChange={(e) => setList((l) => l.map((x) => (x.id === w.id ? { ...x, on: e.target.checked } : x)))} aria-label={`Show ${w.id}`} />
              <span className="flex-1">{WIDGETS.find(([k]) => k === w.id)?.[1]}</span>
              <Button variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between">
          <Button variant="ghost" onClick={() => setList(WIDGETS.map(([id]) => ({ id, on: true })))}>Reset to default</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
