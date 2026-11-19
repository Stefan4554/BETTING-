"use client";
import { useState } from "react";
import type { Bet } from "@/lib/engine/bets";
import { bankrollCurve } from "@/lib/engine/bets";
import { fractionalKelly } from "@/lib/engine/kelly";
import { expectedValue, fairOdds } from "@/lib/engine/odds";
import type { BetStorage } from "@/lib/data/bets";
import { fmtMoney, fmtOdds, fmtPct } from "@/lib/format";
import { BankrollChart } from "@/components/charts/charts";
import { EmptyState, Panel, StatTile } from "@/components/terminal/primitives";
import { Input, Label } from "@/components/ui/input";
import { useBets, useSettings } from "@/components/portfolio/hooks";

export function BankrollView({ storage, initial }: { storage: BetStorage; initial: Bet[] }) {
  const { bets } = useBets(storage, initial);
  const [s, update] = useSettings();
  const curve = bankrollCurve(bets, s.bankroll);
  const peak = curve.reduce((m, c) => Math.max(m, c.bankroll), s.bankroll);
  let maxDd = 0, runPeak = s.bankroll;
  for (const c of curve) { runPeak = Math.max(runPeak, c.bankroll); maxDd = Math.max(maxDd, (runPeak - c.bankroll) / runPeak); }
  const current = curve.at(-1)?.bankroll ?? s.bankroll;
  const exposure = bets.filter((b) => b.status === "pending").reduce((a, b) => a + b.stake, 0);

  const [calc, setCalc] = useState({ p: "55", odds: "2.00", market: "" });
  const p = Number(calc.p) / 100, o = Number(calc.odds), mkt = calc.market ? Number(calc.market) / 100 : undefined;
  const valid = p > 0 && p < 1 && o > 1;
  const k = valid ? fractionalKelly(p, o, { fraction: s.kellyFraction, maxStakePct: s.maxStakePct, modelConfidence: s.modelConfidence, marketProbability: mkt }) : null;

  return (
    <>
      <Panel bodyClassName="grid grid-cols-2 md:grid-cols-6">
        <StatTile label="Starting bankroll" value={fmtMoney(s.bankroll, s.currency)} />
        <StatTile label="Current" value={fmtMoney(current, s.currency)} tone={current >= s.bankroll ? "up" : "down"} />
        <StatTile label="Peak" value={fmtMoney(peak, s.currency)} />
        <StatTile label="Max drawdown" value={fmtPct(maxDd, 1)} tone="down" />
        <StatTile label="Open exposure" value={fmtMoney(exposure, s.currency)} sub={`${fmtPct(current ? exposure / current : null, 1)} of bank`} />
        <StatTile label="Settled bets" value={curve.length} />
      </Panel>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Bankroll history" className="xl:col-span-2">
          {curve.length ? <div className="p-2"><BankrollChart data={curve} height={300} /></div> : <EmptyState icon="info" title="No settled bets yet" />}
        </Panel>
        <Panel title="Stake calculator" subtitle="fractional Kelly">
          <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap gap-2">
              <Label>Starting bankroll<Input type="number" value={s.bankroll} onChange={(e) => update({ bankroll: Math.max(0, Number(e.target.value)) })} className="w-28" /></Label>
              <Label>Kelly fraction %<Input type="number" value={+(s.kellyFraction * 100).toFixed(1)} onChange={(e) => update({ kellyFraction: Math.min(1, Math.max(0.01, Number(e.target.value) / 100)) })} className="w-20" /></Label>
              <Label>Cap % bank<Input type="number" value={+(s.maxStakePct * 100).toFixed(2)} onChange={(e) => update({ maxStakePct: Math.min(1, Math.max(0.001, Number(e.target.value) / 100)) })} className="w-20" /></Label>
              <Label>Model confidence %<Input type="number" value={+(s.modelConfidence * 100).toFixed(0)} onChange={(e) => update({ modelConfidence: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} className="w-20" /></Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Label>Your probability %<Input value={calc.p} onChange={(e) => setCalc({ ...calc, p: e.target.value })} className="w-24" /></Label>
              <Label>Decimal odds<Input value={calc.odds} onChange={(e) => setCalc({ ...calc, odds: e.target.value })} className="w-24" /></Label>
              <Label>Market no-vig % (opt.)<Input value={calc.market} onChange={(e) => setCalc({ ...calc, market: e.target.value })} className="w-24" /></Label>
            </div>
            {k ? (
              <div className="grid grid-cols-2 gap-px bg-line text-xs">
                {[["EV", fmtPct(expectedValue(p, o), 2, true)], ["Fair odds", fmtOdds(fairOdds(p))], ["Full Kelly", fmtPct(k.fullKelly, 2)], ["Sizing probability", fmtPct(k.adjustedProbability, 1)], ["Stake % bank", fmtPct(k.stakePct, 2) + (k.capped ? " (capped)" : "")], ["Stake", fmtMoney(current * k.stakePct, s.currency)]].map(([a, b]) => <div key={a} className="bg-panel px-2 py-1.5"><div className="label-xs">{a}</div><div className="num">{b}</div></div>)}
              </div>
            ) : <p className="text-xs text-down">Enter a probability between 0 and 100 and odds above 1.00.</p>}
            <p className="text-[11px] text-dim">Full Kelly is very aggressive and assumes your probability is exact. Fractional Kelly with a cap reduces drawdowns from model error.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
