"use client";
import { DEFAULT_SETTINGS, useSettings } from "@/components/portfolio/hooks";
import { Panel } from "@/components/terminal/primitives";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SettingsForm({ account, authEnabled }: { account: { email: string | null; role: string } | null; authEnabled: boolean }) {
  const [s, update] = useSettings();
  const pct = (k: "kellyFraction" | "maxStakePct" | "modelConfidence" | "minEdge" | "minDataQuality" | "maxDivergence", label: string, help: string) => (
    <Label className="w-60">
      {label}
      <Input type="number" step="0.5" value={+(s[k] * 100).toFixed(2)} onChange={(e) => { const v = Number(e.target.value) / 100; if (Number.isFinite(v)) update({ [k]: v }); }} />
      <span className="normal-case tracking-normal text-dim">{help}</span>
    </Label>
  );
  return (
    <>
      <Panel title="Account">
        <div className="p-3 text-xs">
          {!authEnabled ? <p className="text-warn">Authentication is disabled because Supabase is not configured. Settings are stored in this browser.</p>
            : account ? <p>Signed in as <b>{account.email}</b> · role <b>{account.role}</b></p> : <p>Not signed in.</p>}
        </div>
      </Panel>
      <Panel title="Staking & value engine" subtitle="stored in this browser">
        <div className="flex flex-wrap gap-4 p-3">
          <Label className="w-60">Bankroll<Input type="number" value={s.bankroll} onChange={(e) => update({ bankroll: Math.max(0, Number(e.target.value)) })} /><span className="normal-case tracking-normal text-dim">Starting bankroll for ROI and stakes</span></Label>
          <Label className="w-60">Currency<Select value={s.currency} onChange={(e) => update({ currency: e.target.value })}>{["EUR", "GBP", "USD", "AUD", "CAD"].map((c) => <option key={c}>{c}</option>)}</Select></Label>
          <Label className="w-60">Odds format<Select value={s.oddsFormat} onChange={(e) => update({ oddsFormat: e.target.value as "decimal" | "american" })}><option value="decimal">Decimal</option><option value="american">American</option></Select><span className="normal-case tracking-normal text-dim">Calculations always use decimal internally</span></Label>
          {pct("kellyFraction", "Kelly fraction %", "25% = quarter Kelly (recommended ≤ 50%)")}
          {pct("maxStakePct", "Max stake % of bankroll", "Hard cap per bet")}
          {pct("modelConfidence", "Model confidence %", "Shrinks model p toward market p for sizing")}
          {pct("minEdge", "Minimum EV %", "Value table threshold")}
          {pct("minDataQuality", "Minimum data quality %", "Freshness + model sample size")}
          {pct("maxDivergence", "Suspect divergence (pts)", "Model vs market gap treated as suspect")}
        </div>
        <div className="border-t border-line p-3"><Button variant="outline" size="sm" onClick={() => update(DEFAULT_SETTINGS)}>Reset to defaults</Button></div>
      </Panel>
      <Panel title="Responsible gambling">
        <p className="p-3 text-xs text-muted">EDGE INTELLIGENCE is an analytics tool. It does not guarantee profit, and past performance or model output does not predict future results. Set limits, never stake money you cannot afford to lose, and seek help if betting stops being fun (e.g. BeGambleAware, Gamblers Anonymous, or your national helpline).</p>
      </Panel>
    </>
  );
}
