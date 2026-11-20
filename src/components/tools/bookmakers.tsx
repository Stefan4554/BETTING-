"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { GroupRow } from "@/lib/finance/metrics";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Money, PageHeader, Panel } from "@/components/app/primitives";
import { CategoryBars } from "@/components/charts/charts";
import { deleteCatalogItem, saveBookmaker, saveBookmakerAccount } from "@/app/actions/settings";
import { CURRENCIES, fmtOdds, fmtPct, fmtPp } from "@/lib/format";
import { cn } from "@/lib/utils";

type Book = { id: string; name: string; key: string; is_exchange: boolean; default_commission: number; website: string | null; owner_id: string | null };
type Account = { bookmaker_id: string; currency: string; commission: number | null; max_stake: number | null; status: string; notes: string | null };

export function BookmakersView({ bookmakers, accounts, groups, exposure, currency: c, convention, rangeLabel }: {
  bookmakers: Book[]; accounts: Account[]; groups: GroupRow[]; exposure: Record<string, number>; currency: string; convention: "odds" | "probability"; rangeLabel: string;
}) {
  const router = useRouter();
  const [edit, setEdit] = React.useState<Book | null>(null);
  const [create, setCreate] = React.useState(false);
  const [onlyUsed, setOnlyUsed] = React.useState(true);
  const stat = (name: string) => groups.find((g) => g.key === name);
  const rows = bookmakers.filter((b) => !onlyUsed || stat(b.name) || accounts.some((a) => a.bookmaker_id === b.id) || b.owner_id);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Bookmakers" description={`${rangeLabel} · ${c} · performance, CLV and account status per bookmaker`} actions={<Button onClick={() => setCreate(true)}><Plus className="h-3.5 w-3.5" /> Custom bookmaker</Button>} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Profit by bookmaker"><CategoryBars data={groups.slice(0, 14)} valueKey="profit" name="Profit" ccy={c} /></Panel>
        <Panel title="CLV by bookmaker" subtitle="soft books with consistently positive CLV are likely to limit you"><CategoryBars data={groups.filter((g) => g.clvSample > 0).slice(0, 14)} valueKey="averageClv" name="Avg CLV" format={convention === "odds" ? "pct" : "pp"} /></Panel>
      </div>
      <Panel title="Bookmakers" actions={<label className="flex items-center gap-1.5 text-[11px] text-muted"><Checkbox checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> Only used</label>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-panel-2"><tr>{["Bookmaker", "Type", "Account", "Max stake", "Bets", "Stake", "P/L", "ROI", "Win %", "Avg odds", "CLV", "Open exposure", ""].map((h) => <th key={h} className="label-xs h-7 whitespace-nowrap px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{rows.map((b) => {
              const s = stat(b.name), acc = accounts.find((a) => a.bookmaker_id === b.id);
              return (
                <tr key={b.id} className="border-b border-line/60">
                  <td className="h-8 px-2 font-medium">{b.name}{b.owner_id && <Badge className="ml-1">custom</Badge>}</td>
                  <td className="px-2 text-muted">{b.is_exchange ? `Exchange · ${fmtPct(acc?.commission ?? b.default_commission, 1)}` : "Sportsbook"}</td>
                  <td className="px-2">{acc ? <Badge tone={acc.status === "active" ? "up" : acc.status === "closed" ? "neutral" : "warn"}>{acc.status} · {acc.currency}</Badge> : <span className="text-dim">—</span>}</td>
                  <td className="px-2">{acc?.max_stake ? <Money value={acc.max_stake} ccy={acc.currency} /> : <span className="text-dim">—</span>}</td>
                  <td className="num px-2">{s?.bets ?? 0}</td><td className="px-2"><Money value={s?.stake ?? 0} ccy={c} /></td><td className="px-2"><Money value={s?.profit ?? null} ccy={c} signed /></td>
                  <td className={cn("num px-2", (s?.roi ?? 0) > 0 ? "text-up" : (s?.roi ?? 0) < 0 ? "text-down" : "")}>{fmtPct(s?.roi, 1, true)}</td><td className="num px-2">{fmtPct(s?.winRate)}</td>
                  <td className="num px-2">{fmtOdds(s?.averageOdds)}</td><td className="num px-2">{convention === "odds" ? fmtPct(s?.averageClv, 1, true) : fmtPp(s?.averageClv)}</td>
                  <td className="px-2"><Money value={exposure[b.name] ?? 0} ccy={c} /></td>
                  <td className="px-2"><Button size="sm" variant="ghost" onClick={() => setEdit(b)}>Account</Button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
      {edit && <AccountDialog b={edit} acc={accounts.find((a) => a.bookmaker_id === edit.id)} onClose={() => setEdit(null)} onDelete={edit.owner_id ? async () => { const r = await deleteCatalogItem("bookmakers", edit.id); if (!r.ok) toast.error(r.error); else { setEdit(null); router.refresh(); } } : undefined} />}
      {create && <CustomDialog onClose={() => setCreate(false)} />}
    </div>
  );
}

function AccountDialog({ b, acc, onClose, onDelete }: { b: Book; acc?: Account; onClose: () => void; onDelete?: () => void }) {
  const router = useRouter();
  const [f, setF] = React.useState({ currency: acc?.currency ?? "EUR", commission: acc?.commission != null ? String(acc.commission * 100) : "", max_stake: acc?.max_stake ? String(acc.max_stake) : "", status: acc?.status ?? "active", notes: acc?.notes ?? "" });
  const save = async () => {
    const r = await saveBookmakerAccount({ bookmaker_id: b.id, currency: f.currency, commission: f.commission ? Number(f.commission) / 100 : null, max_stake: f.max_stake ? Number(f.max_stake) : null, status: f.status, notes: f.notes });
    if (!r.ok) return toast.error(r.error);
    toast.success("Account saved"); router.refresh(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${b.name} account`} description="Track account status (limits, restrictions) and your personal commission rate.">
        <div className="grid grid-cols-2 gap-2">
          <Label>Account currency<Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</Select></Label>
          <Label>Status<Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="limited">Limited</option><option value="restricted">Restricted</option><option value="closed">Closed</option></Select></Label>
          <Label>Your commission %<Input inputMode="decimal" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} placeholder={String(b.default_commission * 100)} /></Label>
          <Label>Max stake accepted<Input inputMode="decimal" value={f.max_stake} onChange={(e) => setF({ ...f, max_stake: e.target.value })} /></Label>
          <Label className="col-span-2">Notes<Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Label>
        </div>
        <div className="mt-3 flex justify-between">{onDelete ? <Button variant="danger" onClick={onDelete}>Delete custom bookmaker</Button> : <span />}<Button onClick={save}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function CustomDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", is_exchange: false, commission: "0", website: "" });
  const save = async () => {
    const r = await saveBookmaker({ name: f.name, is_exchange: f.is_exchange, default_commission: Number(f.commission) / 100, website: f.website });
    if (!r.ok) return toast.error(r.error);
    toast.success("Bookmaker added"); router.refresh(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Custom bookmaker" description="Private to your account.">
        <div className="grid grid-cols-2 gap-2">
          <Label className="col-span-2">Name<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
          <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={f.is_exchange} onChange={(e) => setF({ ...f, is_exchange: e.target.checked })} /> Betting exchange</label>
          <Label>Default commission %<Input inputMode="decimal" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></Label>
          <Label className="col-span-2">Website<Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={save} disabled={!f.name}>Add</Button></div>
      </DialogContent>
    </Dialog>
  );
}
