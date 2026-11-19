"use client";
import { useState } from "react";
import type { Bet, PerformanceSummary } from "@/lib/engine/bets";
import { byPeriod, groupBy, summarize } from "@/lib/engine/bets";
import type { BetStorage } from "@/lib/data/bets";
import { fmtMoney, fmtOdds, fmtPct, MARKET_LABEL } from "@/lib/format";
import { ProfitBars } from "@/components/charts/charts";
import { EmptyState, Missing, Panel, StatTile } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useBets, useSettings } from "@/components/portfolio/hooks";
import { cn } from "@/lib/utils";

function GroupTable({ data, label }: { data: Record<string, PerformanceSummary>; label?: (k: string) => string }) {
  const rows = Object.entries(data).sort((a, b) => b[1].profit - a[1].profit);
  return (
    <Table>
      <THead><TR><TH>Group</TH><TH className="text-right">Bets</TH><TH className="text-right">Staked</TH><TH className="text-right">Profit</TH><TH className="text-right">Yield</TH><TH className="text-right">Win %</TH><TH className="text-right">Avg odds</TH><TH className="text-right">CLV</TH></TR></THead>
      <tbody>{rows.map(([k, s]) => (
        <TR key={k}>
          <TD>{label ? label(k) : k}</TD><TD className="num text-right">{s.settled}</TD><TD className="num text-right">{s.totalStaked.toFixed(2)}</TD>
          <TD className={cn("num text-right", s.profit >= 0 ? "text-up" : "text-down")}>{s.profit.toFixed(2)}</TD>
          <TD className={cn("num text-right", s.yield >= 0 ? "text-up" : "text-down")}>{fmtPct(s.yield, 1, true)}</TD>
          <TD className="num text-right">{fmtPct(s.winRate, 0)}</TD><TD className="num text-right">{fmtOdds(s.averageOdds)}</TD>
          <TD className="num text-right">{s.averageClv == null ? <Missing /> : fmtPct(s.averageClv, 1, true)}</TD>
        </TR>
      ))}</tbody>
    </Table>
  );
}

export function PerformanceView({ storage, initial }: { storage: BetStorage; initial: Bet[] }) {
  const { bets } = useBets(storage, initial);
  const [settings] = useSettings();
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  if (!bets.length) return <Panel><EmptyState icon="info" title="No bets recorded yet">Add bets in the tracker to see performance.</EmptyState></Panel>;
  const s = summarize(bets, settings.bankroll);
  const per = byPeriod(bets, period);
  return (
    <>
      <Panel bodyClassName="grid grid-cols-3 md:grid-cols-7">
        <StatTile label="Profit" value={fmtMoney(s.profit, settings.currency)} tone={s.profit >= 0 ? "up" : "down"} />
        <StatTile label="ROI" value={fmtPct(s.roi, 2, true)} tone={(s.roi ?? 0) >= 0 ? "up" : "down"} sub="on bankroll" />
        <StatTile label="Yield" value={fmtPct(s.yield, 2, true)} tone={s.yield >= 0 ? "up" : "down"} sub="on turnover" />
        <StatTile label="Win rate" value={fmtPct(s.winRate)} />
        <StatTile label="Avg odds" value={fmtOdds(s.averageOdds)} />
        <StatTile label="Avg CLV" value={s.averageClv == null ? <Missing /> : fmtPct(s.averageClv, 2, true)} tone={(s.averageClv ?? 0) >= 0 ? "up" : "down"} />
        <StatTile label="Settled" value={s.settled} sub={`${s.pending} pending`} />
      </Panel>
      <Panel title="Profit by period" actions={(["day", "week", "month"] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} className={`h-6 rounded-[3px] border px-2 text-[11px] ${period === p ? "border-accent bg-accent-soft" : "border-line-strong text-muted"}`}>{p}</button>)}>
        <div className="p-2"><ProfitBars data={Object.entries(per).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ key: k.slice(5), profit: v.profit }))} /></div>
        <GroupTable data={per} />
      </Panel>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="By sport"><GroupTable data={groupBy(bets, (b) => b.sport)} /></Panel>
        <Panel title="By market"><GroupTable data={groupBy(bets, (b) => b.market)} label={(k) => MARKET_LABEL[k] ?? k} /></Panel>
        <Panel title="By bookmaker"><GroupTable data={groupBy(bets, (b) => b.bookmaker)} /></Panel>
      </div>
    </>
  );
}
