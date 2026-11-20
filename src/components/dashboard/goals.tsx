"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { GoalProgress } from "@/lib/server/goals";
import { Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { deleteGoal, saveGoal } from "@/app/actions/finance";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtPp } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = { profit: "Profit", roi: "ROI", bankroll: "Bankroll", clv: "Average CLV", bets: "Settled bets", win_rate: "Win rate" };

export function GoalsPanel({ goals, currency, convention }: { goals: GoalProgress[]; currency: string; convention: "odds" | "probability" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const fmt = (metric: string, v: number | null) => metric === "profit" || metric === "bankroll" ? fmtMoney(v, currency) : metric === "bets" ? fmtNum(v) : metric === "clv" && convention === "probability" ? fmtPp(v) : fmtPct(v, 1);
  return (
    <Panel title="Goals" actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3 w-3" /> Goal</Button>} bodyClassName="p-3">
      {goals.length === 0 && <p className="py-6 text-center text-xs text-dim">No goals. Set targets for profit, ROI, bankroll, CLV, volume or win rate.</p>}
      <div className="flex flex-col gap-2">{goals.map((g) => (
        <div key={g.id} className="text-xs">
          <div className="flex items-center gap-2"><b>{g.name}</b><span className="text-dim">{LABEL[g.metric]} · {fmtDate(g.periodStart)} → {fmtDate(g.periodEnd)}</span>
            <span className="num ml-auto">{fmt(g.metric, g.current)} / {fmt(g.metric, g.target)}</span>
            <button aria-label="Delete goal" className="text-dim hover:text-down" onClick={async () => { await deleteGoal(g.id); router.refresh(); }}><Trash2 className="h-3 w-3" /></button></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised"><div className={cn("h-full", g.achieved ? "bg-up" : (g.progress ?? 0) < 0 ? "bg-down" : "bg-accent")} style={{ width: `${Math.max(0, Math.min(100, (g.progress ?? 0) * 100))}%` }} /></div>
        </div>
      ))}</div>
      <GoalDialog open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

function GoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const y = new Date().getUTCFullYear();
  const [f, setF] = React.useState({ name: "", metric: "profit", target: "", period_start: `${y}-01-01`, period_end: `${y}-12-31` });
  const pctMetric = ["roi", "clv", "win_rate"].includes(f.metric);
  const save = async () => {
    const r = await saveGoal({ ...f, target: Number(f.target) / (pctMetric ? 100 : 1) });
    if (!r.ok) return toast.error(r.error);
    toast.success("Goal saved"); onOpenChange(false); router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New goal">
        <div className="grid grid-cols-2 gap-2">
          <Label className="col-span-2">Name<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="2027 profit target" /></Label>
          <Label>Metric<Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Label>
          <Label>Target{pctMetric ? " (%)" : ""}<Input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Label>
          <Label>From<Input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} /></Label>
          <Label>To<Input type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} /></Label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={save} disabled={!f.name || !f.target}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}
