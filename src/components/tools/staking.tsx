"use client";
import * as React from "react";
import { KV, Notice, PageHeader, Panel } from "@/components/app/primitives";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNewBet } from "@/components/app/app-data";
import { kellyTable, recommendStake, type StakingSystem } from "@/lib/finance/staking";
import { parseOdds } from "@/lib/finance/odds";
import { arbitrage } from "@/lib/finance/arbitrage";
import { fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StakingCalculator({ defaults }: { defaults: { bankroll: number; currency: string; kellyFraction: number; unitSize: number; maxStake: number | null; maxPct: number | null } }) {
  const newBet = useNewBet();
  const [f, setF] = React.useState({
    bankroll: String(Math.round(defaults.bankroll * 100) / 100), odds: "2.10", prob: "52", fraction: String(defaults.kellyFraction),
    maxStake: defaults.maxStake ? String(defaults.maxStake) : "", maxPct: defaults.maxPct ? String(defaults.maxPct * 100) : "", exposure: "",
    system: "kelly", flat: "25", pct: "2", units: "1", unitSize: String(defaults.unitSize), target: "50",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const c = defaults.currency;
  let calc: ReturnType<typeof kellyTable> | null = null, err: string | null = null, odds = 0, p = 0;
  const bankroll = Number(f.bankroll);
  const limits = { maxStake: f.maxStake ? Number(f.maxStake) : null, maxStakePct: f.maxPct ? Number(f.maxPct) / 100 : null, maxExposureRemaining: f.exposure ? Number(f.exposure) : null };
  try {
    odds = parseOdds(f.odds);
    p = Number(f.prob) / 100;
    if (!(p > 0 && p < 1)) throw new Error("Probability must be between 0 and 100%");
    if (!(bankroll > 0)) throw new Error("Bankroll must be positive");
    calc = kellyTable(bankroll, odds, p, limits);
  } catch (e) { err = (e as Error).message; }
  const system: StakingSystem | null = (() => {
    switch (f.system) {
      case "flat": return { type: "flat", amount: Number(f.flat) };
      case "percentage": return { type: "percentage", pct: Number(f.pct) / 100 };
      case "units": return { type: "units", units: Number(f.units), unitSize: Number(f.unitSize) };
      case "kelly": return { type: "kelly", fraction: Math.min(1, Math.max(0.001, Number(f.fraction))) };
      case "fixed_profit": return { type: "custom", formula: "fixed_profit", target: Number(f.target) };
      default: return null;
    }
  })();
  let rec: ReturnType<typeof recommendStake> | null = null;
  try { if (calc && system) rec = recommendStake(system, { bankroll, odds, probability: p }, limits); } catch (e) { err = (e as Error).message; }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Staking & Kelly Calculator" description="f* = (b·p − q) / b with b = odds − 1, q = 1 − p. Negative edges never produce a stake." />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="Inputs" bodyClassName="grid grid-cols-2 gap-2 p-3">
          <Label>Bankroll ({c})<Input inputMode="decimal" value={f.bankroll} onChange={set("bankroll")} /></Label>
          <Label>Decimal odds<Input inputMode="decimal" value={f.odds} onChange={set("odds")} placeholder="2.10, +110, 11/10" /></Label>
          <Label>Estimated probability %<Input inputMode="decimal" value={f.prob} onChange={set("prob")} /></Label>
          <Label>Kelly fraction<Input inputMode="decimal" value={f.fraction} onChange={set("fraction")} /></Label>
          <Label>Max stake ({c})<Input inputMode="decimal" value={f.maxStake} onChange={set("maxStake")} placeholder="none" /></Label>
          <Label>Max % of bankroll<Input inputMode="decimal" value={f.maxPct} onChange={set("maxPct")} placeholder="none" /></Label>
          <Label className="col-span-2">Remaining exposure headroom ({c})<Input inputMode="decimal" value={f.exposure} onChange={set("exposure")} placeholder="none" /></Label>
          <Label className="col-span-2">Staking system
            <Select value={f.system} onChange={set("system")}>
              <option value="kelly">Fractional Kelly</option><option value="flat">Flat stake</option><option value="percentage">Percentage of bankroll</option>
              <option value="units">Fixed units</option><option value="fixed_profit">Custom: stake to win a fixed amount</option>
            </Select>
          </Label>
          {f.system === "flat" && <Label className="col-span-2">Flat stake<Input inputMode="decimal" value={f.flat} onChange={set("flat")} /></Label>}
          {f.system === "percentage" && <Label className="col-span-2">% of bankroll<Input inputMode="decimal" value={f.pct} onChange={set("pct")} /></Label>}
          {f.system === "units" && <><Label>Units<Input inputMode="decimal" value={f.units} onChange={set("units")} /></Label><Label>Unit size<Input inputMode="decimal" value={f.unitSize} onChange={set("unitSize")} /></Label></>}
          {f.system === "fixed_profit" && <Label className="col-span-2">Target profit<Input inputMode="decimal" value={f.target} onChange={set("target")} /></Label>}
        </Panel>
        <Panel title="Results" bodyClassName="p-3">
          {err && <Notice level="error">{err}</Notice>}
          {calc && (
            <>
              <KV k="Implied probability" v={fmtPct(calc.implied, 2)} />
              <KV k="Estimated probability" v={fmtPct(p, 2)} />
              <KV k="Betting edge" v={<span className={calc.edge > 0 ? "text-up" : "text-down"}>{fmtPct(calc.edge, 2, true)}</span>} />
              <KV k="Expected value per unit" v={<span className={calc.ev > 0 ? "text-up" : "text-down"}>{fmtPct(calc.ev, 2, true)}</span>} />
              <KV k="Full Kelly fraction" v={fmtPct(calc.fullKelly, 2)} />
              {rec && <>
                <div className="mt-3 rounded-[3px] border border-accent/40 bg-accent-soft/30 p-3">
                  <div className="label-xs">Recommended stake</div>
                  <div className="num text-2xl">{fmtMoney(rec.stake, c)}</div>
                  <div className="text-[11px] text-muted">{fmtPct(bankroll ? rec.stake / bankroll : null, 2)} of bankroll · expected profit {fmtMoney(rec.stake * calc.ev, c, true)}
                    {rec.cappedBy.length > 0 && <> · capped by {rec.cappedBy.join(", ").replace("negative_edge", "no edge")}</>}</div>
                </div>
                <Button className="mt-2 w-full" disabled={!rec.stake} onClick={() => newBet.open({ odds: odds, stake: rec!.stake, est_probability: p })}>Use in new bet</Button>
              </>}
              {calc.ev <= 0 && <Notice level="warn" className="mt-2">No positive edge at these inputs: Kelly recommends no bet.</Notice>}
            </>
          )}
        </Panel>
        <Panel title="Kelly fractions">
          <table className="w-full text-xs"><thead className="bg-panel-2"><tr>{["Fraction", "% bankroll", "Stake", "Exp. profit"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{calc?.rows.map((r) => (
              <tr key={r.label} className={cn("border-b border-line/60", Math.abs(r.fraction - Number(f.fraction)) < 1e-9 && "bg-accent-soft/20")}>
                <td className="h-8 px-2">{r.label}</td><td className="num px-2">{fmtPct(r.stakePct, 2)}</td><td className="num px-2">{fmtMoney(r.stake, c)}</td><td className="num px-2">{fmtMoney(r.expectedProfit, c, true)}</td>
              </tr>
            ))}</tbody></table>
          <p className="p-3 text-[11px] text-dim">Full Kelly maximises long-run growth only if your probability is exact. Fractional Kelly reduces variance and the damage of overestimated edges. Limits above apply to every row.</p>
        </Panel>
      </div>
      <ArbCalculator currency={c} />
    </div>
  );
}

function ArbCalculator({ currency }: { currency: string }) {
  const [legs, setLegs] = React.useState([{ odds: "2.10", comm: "0", max: "" }, { odds: "2.05", comm: "0", max: "" }]);
  const [total, setTotal] = React.useState("100");
  let r: ReturnType<typeof arbitrage> | null = null, err: string | null = null;
  try { r = arbitrage(legs.map((l, i) => ({ selection: `Outcome ${i + 1}`, bookmaker: "", odds: parseOdds(l.odds), commission: Number(l.comm) / 100, maxStake: l.max ? Number(l.max) : null })), Number(total)); } catch (e) { err = (e as Error).message; }
  return (
    <Panel title="Arbitrage / dutching calculator" subtitle="theoretical — verify executable prices, limits and settlement rules" bodyClassName="p-3">
      <div className="flex flex-col gap-1.5">
        {legs.map((l, i) => (
          <div key={i} className="grid grid-cols-[90px_1fr_1fr_1fr_auto] items-end gap-2">
            <span className="text-xs text-muted">Outcome {i + 1}</span>
            <Label>Odds<Input inputMode="decimal" value={l.odds} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, odds: e.target.value } : x)))} /></Label>
            <Label>Commission %<Input inputMode="decimal" value={l.comm} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, comm: e.target.value } : x)))} /></Label>
            <Label>Max stake<Input inputMode="decimal" value={l.max} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} /></Label>
            <span className="num pb-1.5 text-xs">{r ? fmtMoney(r.legs[i]?.stake, currency) : ""}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setLegs([...legs, { odds: "", comm: "0", max: "" }])}>Add outcome</Button>
          {legs.length > 2 && <Button size="sm" variant="ghost" onClick={() => setLegs(legs.slice(0, -1))}>Remove</Button>}
          <Label className="ml-auto">Total stake<Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="w-28" /></Label>
        </div>
        {err && <p className="text-xs text-down">{err}</p>}
        {r && <p className={cn("text-xs", r.isArb ? "text-up" : "text-muted")}>Book Σ1/odds = {(r.bookSum * 100).toFixed(2)}% · {r.isArb ? `ARBITRAGE (theoretical): guaranteed return ${fmtMoney(r.guaranteedReturn, currency)}, profit ${fmtMoney(r.guaranteedProfit, currency, true)} (${fmtPct(r.margin, 2, true)})` : `no arbitrage: equal-return dutching loses ${fmtMoney(-r.guaranteedProfit, currency)}`}{r.limitedByMaxStake ? " · scaled down by max stake" : ""}</p>}
      </div>
    </Panel>
  );
}
