"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KV, Money, PageHeader, Panel } from "@/components/app/primitives";
import { CategoryBars, TimeSeries } from "@/components/charts/charts";
import { useAppData } from "@/components/app/app-data";
import { deleteStrategy, saveStrategy } from "@/app/actions/finance";
import { fmtMoney, fmtOdds, fmtPct, fmtPp } from "@/lib/format";
import { cn } from "@/lib/utils";

type Strat = { id: string; name: string; description: string | null; sport_id: string | null; market_type_id: string | null; entry_conditions: string | null; min_odds: number | null; max_odds: number | null; est_probability: number | null; stake_rule: { type: string; value: number }; color: string; is_active: boolean };
type Stat = { bets: number; settled: number; stake: number; profit: number; roi: number | null; yield: number | null; winRate: number | null; avgOdds: number | null; clv: number | null; clvSample: number; maxDd: number; sharpe: number | null; evRoi: number | null; pending: number };

export function StrategiesView({ strategies, stats, curve, currency: c, convention, rangeLabel, focus }: {
  strategies: Strat[]; stats: Record<string, Stat>; curve: Record<string, unknown>[]; currency: string; convention: "odds" | "probability"; rangeLabel: string; focus?: string;
}) {
  const router = useRouter();
  const app = useAppData();
  const [editing, setEditing] = React.useState<Strat | "new" | null>(null);
  const [compare, setCompare] = React.useState<string[]>(() => strategies.slice(0, 4).map((s) => s.name));
  const rows = [...strategies.map((s) => ({ s, st: stats[s.name]! })), ...(stats["No strategy"]?.bets ? [{ s: null, st: stats["No strategy"]! }] : [])];
  const clvFmt = (v: number | null) => (convention === "odds" ? fmtPct(v, 2, true) : fmtPp(v));
  React.useEffect(() => { if (focus) document.getElementById(`s-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus]);
  const series = compare.slice(0, 6).map((n) => ({ key: n, name: n, color: strategies.find((s) => s.name === n)?.color }));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Strategy Manager" description={`${rangeLabel} · ${c}`} actions={<Button onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> New strategy</Button>} />
      <Panel title="Strategies">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-panel-2"><tr>{["", "Strategy", "Sport", "Odds range", "Stake rule", "Bets", "Stake", "P/L", "ROI", "Win %", "Avg odds", "CLV", "Max DD", "Sharpe", "Exp. ROI", ""].map((h, i) => <th key={i} className="label-xs h-7 whitespace-nowrap px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{rows.map(({ s, st }) => (
              <tr key={s?.id ?? "none"} id={s ? `s-${s.id}` : undefined} className={cn("border-b border-line/60", s?.id === focus && "bg-accent-soft/20", s && !s.is_active && "opacity-60")}>
                <td className="px-2"><Checkbox checked={compare.includes(s?.name ?? "No strategy")} onChange={(e) => { const n = s?.name ?? "No strategy"; setCompare((x) => (e.target.checked ? [...x, n] : x.filter((y) => y !== n))); }} aria-label="Compare" /></td>
                <td className="h-8 px-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s?.color ?? "var(--dim)" }} /><span className="font-medium">{s?.name ?? "No strategy"}</span>{s && !s.is_active && <Badge>inactive</Badge>}</span>
                  {s?.description && <div className="max-w-[260px] truncate text-[11px] text-dim" title={s.description}>{s.description}</div>}</td>
                <td className="px-2 text-muted">{app.sports.find((x) => x.id === s?.sport_id)?.name ?? "—"}</td>
                <td className="num px-2">{s?.min_odds || s?.max_odds ? `${s.min_odds?.toFixed(2) ?? "…"}–${s.max_odds?.toFixed(2) ?? "…"}` : "—"}</td>
                <td className="px-2 text-muted">{s ? `${s.stake_rule.type} ${s.stake_rule.value}` : "—"}</td>
                <td className="num px-2">{st.bets}</td><td className="px-2"><Money value={st.stake} ccy={c} /></td><td className="px-2"><Money value={st.profit} ccy={c} signed /></td>
                <td className={cn("num px-2", (st.roi ?? 0) > 0 ? "text-up" : (st.roi ?? 0) < 0 ? "text-down" : "")}>{fmtPct(st.roi, 1, true)}</td>
                <td className="num px-2">{fmtPct(st.winRate)}</td><td className="num px-2">{fmtOdds(st.avgOdds)}</td><td className="num px-2">{clvFmt(st.clv)}<span className="text-dim"> ({st.clvSample})</span></td>
                <td className="px-2"><Money value={-st.maxDd} ccy={c} /></td><td className="num px-2">{st.sharpe?.toFixed(3) ?? "—"}</td><td className="num px-2">{fmtPct(st.evRoi, 1, true)}</td>
                <td className="px-2">{s && <span className="flex gap-0.5">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(s)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Delete" onClick={async () => { if (!confirm(`Delete "${s.name}"? Bets keep their data but lose the strategy link.`)) return; const r = await deleteStrategy(s.id); if (!r.ok) toast.error(r.error); else router.refresh(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>}</td>
              </tr>
            ))}{!rows.length && <tr><td colSpan={16} className="py-8 text-center text-dim">No strategies yet.</td></tr>}</tbody>
          </table>
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Strategy comparison" subtitle={`cumulative P/L${compare.length > 6 ? " · first 6 selected shown" : ""}`}><TimeSeries data={curve} series={series} ccy={c} height={260} /></Panel>
        <Panel title="ROI by strategy"><CategoryBars data={rows.map(({ s, st }) => ({ key: s?.name ?? "No strategy", roi: st.roi }))} valueKey="roi" name="ROI" format="pct" /></Panel>
      </div>
      {editing && <StrategyDialog s={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StrategyDialog({ s, onClose }: { s: Strat | null; onClose: () => void }) {
  const app = useAppData();
  const router = useRouter();
  const [f, setF] = React.useState({
    name: s?.name ?? "", description: s?.description ?? "", sport_id: s?.sport_id ?? "", market_type_id: s?.market_type_id ?? "", entry_conditions: s?.entry_conditions ?? "",
    min_odds: s?.min_odds?.toString() ?? "", max_odds: s?.max_odds?.toString() ?? "", est_probability: s?.est_probability != null ? String(s.est_probability * 100) : "",
    stake_type: s?.stake_rule.type ?? "flat", stake_value: String(s?.stake_rule.value ?? 1), color: s?.color ?? "#3987e5", is_active: s?.is_active ?? true,
  });
  const [err, setErr] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const r = await saveStrategy({ ...f, id: s?.id, est_probability: f.est_probability ? Number(f.est_probability) / 100 : undefined } as never);
    if (!r.ok) { setErr(r.fieldErrors ?? {}); return toast.error(r.error); }
    toast.success("Strategy saved"); router.refresh(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide title={s ? `Edit ${s.name}` : "New strategy"}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Label className="col-span-2">Name<Input value={f.name} onChange={set("name")} /><FieldError>{err.name}</FieldError></Label>
          <Label>Sport<Select value={f.sport_id} onChange={set("sport_id")}><option value="">Any</option>{app.sports.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Label>
          <Label>Market<Select value={f.market_type_id} onChange={set("market_type_id")}><option value="">Any</option>{app.marketTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Label>
          <Label className="col-span-2 md:col-span-4">Description<Textarea value={f.description} onChange={set("description")} /></Label>
          <Label className="col-span-2 md:col-span-4">Entry conditions<Textarea value={f.entry_conditions} onChange={set("entry_conditions")} placeholder="e.g. price beats sharp no-vig line by ≥ 3%" /></Label>
          <Label>Min odds<Input inputMode="decimal" value={f.min_odds} onChange={set("min_odds")} /></Label>
          <Label>Max odds<Input inputMode="decimal" value={f.max_odds} onChange={set("max_odds")} /><FieldError>{err.max_odds}</FieldError></Label>
          <Label>Typical est. probability %<Input inputMode="decimal" value={f.est_probability} onChange={set("est_probability")} /></Label>
          <Label>Colour<Input type="color" value={f.color} onChange={set("color")} className="p-0.5" /></Label>
          <Label>Stake rule<Select value={f.stake_type} onChange={set("stake_type")}><option value="flat">Flat amount</option><option value="percentage">% of bankroll</option><option value="units">Units</option><option value="kelly">Kelly fraction</option></Select></Label>
          <Label>Rule value<Input inputMode="decimal" value={f.stake_value} onChange={set("stake_value")} /></Label>
          <label className="col-span-2 flex items-center gap-1.5 self-end text-xs"><Checkbox checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>
        </div>
        <KV className="mt-3" k="Stake rule meaning" v={f.stake_type === "kelly" ? `${f.stake_value} × full Kelly` : f.stake_type === "percentage" ? `${f.stake_value}% of bankroll` : f.stake_type === "units" ? `${f.stake_value} units` : fmtMoney(Number(f.stake_value), app.displayCurrency)} />
        <div className="mt-3 flex justify-end"><Button onClick={save} disabled={!f.name}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}
