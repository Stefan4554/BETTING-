"use client";
import type { Analytics } from "@/lib/server/analytics";
import { KV, Kpi, Notice, PageHeader, Panel, SampleWarning, toneOf } from "@/components/app/primitives";
import { CategoryBars, SignedBars, TimeSeries } from "@/components/charts/charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { GroupTable } from "./group-table";
import { fmtMoney, fmtNum, fmtOdds, fmtPct, fmtPp } from "@/lib/format";

export function PerformanceView({ a, rangeLabel }: { a: Analytics; rangeLabel: string }) {
  const s = a.summary, c = a.currency;
  const pf = s.profitFactor == null ? (s.grossLoss === 0 && s.grossWin > 0 ? "∞ (no losses)" : "—") : s.profitFactor.toFixed(2);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Performance Analytics" description={`${rangeLabel} · ${c} · per-bet risk metrics are not annualised`} />
      <SampleWarning n={s.settledBets} />
      {a.unconverted > 0 && <Notice level="warn">{a.unconverted} bets excluded for missing FX rates.</Notice>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Net P/L" value={fmtMoney(s.netProfit, c, true)} tone={toneOf(s.netProfit)} />
        <Kpi label="ROI / Yield" value={fmtPct(s.roi, 2, true)} tone={toneOf(s.roi)} />
        <Kpi label="Profit factor" value={pf} />
        <Kpi label="Sharpe (per bet)" value={s.sharpe?.toFixed(3) ?? "—"} />
        <Kpi label="Sortino (per bet)" value={s.sortino?.toFixed(3) ?? "—"} />
        <Kpi label="Max drawdown" value={fmtMoney(-s.drawdown.maxAmount, c)} sub={fmtPct(s.drawdown.maxPct)} tone={s.drawdown.maxAmount ? "down" : "neutral"} />
        <Kpi label="Recovery factor" value={s.recoveryFactor?.toFixed(2) ?? "—"} />
        <Kpi label="Risk of ruin" value={s.riskOfRuin == null ? "—" : s.riskOfRuin < 0.0001 ? "<0.01%" : fmtPct(s.riskOfRuin, 2)} sub={s.riskOfRuin == null ? "needs ≥30 bets" : "diffusion approx."} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Return statistics" bodyClassName="p-3">
          <KV k="Settled / total bets" v={`${fmtNum(s.settledBets)} / ${fmtNum(s.totalBets)}`} />
          <KV k="Wins / losses / voids" v={`${s.wins} / ${s.losses} / ${s.voidBets}`} />
          <KV k="Win rate (ex. void)" v={fmtPct(s.winRate)} />
          <KV k="Average odds" v={fmtOdds(s.averageOdds)} />
          <KV k="Average stake" v={fmtMoney(s.averageStake, c)} />
          <KV k="Average profit per bet" v={fmtMoney(s.averageProfitPerBet, c, true)} />
          <KV k="Average win / average loss" v={`${fmtMoney(s.averageWin, c)} / ${fmtMoney(s.averageLoss, c)}`} />
          <KV k="Gross won / gross lost" v={`${fmtMoney(s.grossWin, c)} / ${fmtMoney(s.grossLoss, c)}`} />
          <KV k="Std. deviation of return" v={fmtPct(s.stdDevReturn, 1)} />
          <KV k="Variance of return" v={s.varianceReturn?.toFixed(4) ?? "—"} />
          <KV k="Std. deviation of P/L" v={fmtMoney(s.stdDevProfit, c)} />
        </Panel>
        <Panel title="Expectation vs realisation" bodyClassName="p-3">
          <KV k="Bets with probability estimate" v={fmtNum(s.evSample)} />
          <KV k="Expected profit (Σ EV)" v={fmtMoney(s.expectedProfit, c, true)} />
          <KV k="Expected ROI" v={fmtPct(s.expectedRoi, 2, true)} />
          <KV k="Realised ROI (same bets)" v={fmtPct(s.realizedRoiOnEvSample, 2, true)} />
          <KV k="Average edge (est. − implied)" v={fmtPp(s.averageEdge)} />
          <KV k={`Average CLV (${a.convention})`} v={a.convention === "odds" ? fmtPct(s.averageClv, 2, true) : fmtPp(s.averageClv)} />
          <KV k="Bets beating the close" v={fmtPct(s.positiveClvRate)} />
          <p className="mt-2 text-[11px] text-dim">Large gaps between expected and realised ROI over small samples are normal variance. CLV converges much faster than ROI.</p>
        </Panel>
        <Panel title="Streaks & drawdown" bodyClassName="p-3">
          <KV k="Longest winning streak" v={s.longestWinStreak} />
          <KV k="Longest losing streak" v={s.longestLossStreak} />
          <KV k="Current streak" v={s.currentStreak ? `${s.currentStreak.length} ${s.currentStreak.type}${s.currentStreak.length > 1 ? (s.currentStreak.type === "win" ? "s" : "es") : ""}` : "—"} />
          <KV k="Max drawdown" v={`${fmtMoney(-s.drawdown.maxAmount, c)} (${fmtPct(s.drawdown.maxPct)})`} />
          <KV k="Current drawdown" v={`${fmtMoney(-s.drawdown.currentAmount, c)} (${fmtPct(s.drawdown.currentPct)})`} />
          <KV k="Drawdown recovered" v={s.drawdown.maxAmount ? (s.drawdown.recovered ? "Yes" : "No") : "—"} />
          <KV k="Live trading P/L (all time)" v={fmtMoney(a.tradePnl, c, true)} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Cumulative P&L"><TimeSeries data={a.curve} series={[{ key: "cumProfit", name: "P&L" }]} area ccy={c} /></Panel>
        <Panel title="Monthly P&L"><SignedBars data={a.monthly} xKey="period" yKey="profit" name="P&L" ccy={c} /></Panel>
        <Panel title="ROI over time"><TimeSeries data={a.curve} series={[{ key: "roi", name: "Cumulative ROI", color: "var(--s1)" }]} format="pct" /></Panel>
        <Panel title="ROI by odds band"><CategoryBars data={a.byOdds} valueKey="roi" name="ROI" format="pct" /></Panel>
      </div>
      <Panel title="Breakdowns">
        <Tabs defaultValue="sport" className="p-2">
          <TabsList>{([["sport", "Sport"], ["league", "League"], ["market", "Market"], ["bookmaker", "Bookmaker"], ["strategy", "Strategy"], ["timing", "Pre-match / live"], ["kind", "Single / acca"], ["odds", "Odds band"], ["stake", "Stake band"], ["month", "Month"]] as const).map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList>
          <TabsContent value="sport"><GroupTable rows={a.bySport} ccy={c} label="Sport" convention={a.convention} cols={["bets", "stake", "profit", "roi", "winRate", "averageOdds", "averageClv", "maxDrawdown"]} /></TabsContent>
          <TabsContent value="league"><GroupTable rows={a.byLeague} ccy={c} label="League" convention={a.convention} /></TabsContent>
          <TabsContent value="market"><GroupTable rows={a.byMarket} ccy={c} label="Market" convention={a.convention} /></TabsContent>
          <TabsContent value="bookmaker"><GroupTable rows={a.byBookmaker} ccy={c} label="Bookmaker" convention={a.convention} /></TabsContent>
          <TabsContent value="strategy"><GroupTable rows={a.byStrategy} ccy={c} label="Strategy" convention={a.convention} cols={["bets", "stake", "profit", "roi", "winRate", "averageOdds", "averageClv", "maxDrawdown"]} /></TabsContent>
          <TabsContent value="timing"><GroupTable rows={a.byLive} ccy={c} label="Timing" convention={a.convention} /></TabsContent>
          <TabsContent value="kind"><GroupTable rows={a.byKind} ccy={c} label="Type" convention={a.convention} /></TabsContent>
          <TabsContent value="odds"><GroupTable rows={a.byOdds} ccy={c} label="Odds" convention={a.convention} /></TabsContent>
          <TabsContent value="stake"><GroupTable rows={a.byStake} ccy={c} label="Stake" convention={a.convention} /></TabsContent>
          <TabsContent value="month"><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-panel-2"><tr>{["Month", "Bets", "Stake", "P/L", "ROI", "Win %"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{a.monthly.map((m) => <tr key={m.period} className="border-b border-line/60"><td className="num h-7 px-2">{m.period}</td><td className="num px-2">{m.bets}</td><td className="num px-2">{fmtMoney(m.stake, c)}</td><td className={`num px-2 ${m.profit >= 0 ? "text-up" : "text-down"}`}>{fmtMoney(m.profit, c, true)}</td><td className="num px-2">{fmtPct(m.roi, 1, true)}</td><td className="num px-2">{fmtPct(m.winRate)}</td></tr>)}</tbody></table></div></TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
