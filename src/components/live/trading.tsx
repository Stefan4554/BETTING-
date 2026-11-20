"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Kpi, Money, Notice, PageHeader, Panel, toneOf } from "@/components/app/primitives";
import { useAppData } from "@/components/app/app-data";
import { addExecution, openTrade, settleTrade } from "@/app/actions/finance";
import { greenUp, position, settlePosition, type Execution } from "@/lib/finance/trading";
import { fmtAgo, fmtDateTime, fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Trade = {
  id: string; event: string; event_id: string | null; market: string; selection: string; sport: string; bookmaker: string | null; bankroll_id: string; currency: string;
  commission: number; status: string; outcome: string | null; opened_at: string; closed_at: string | null; realized: number | null; notes: string | null;
  executions: Execution[]; price: { odds: number; at: string; source: string } | null;
};
type LiveEvent = { id: string; name: string; sport: string; sportId: string; start: string; provider: string | null; prices: { name: string; odds: number | null; book: string | null; at: string | null; move: number | null }[] };

/** Demo-only simulated price ticker: a bounded random walk, clearly labelled. */
function useSimulatedPrices(trades: Trade[], enabled: boolean) {
  const [px, setPx] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (!enabled) return;
    const init: Record<string, number> = {};
    for (const t of trades) if (t.status === "open") { const p = position(t.executions); init[t.id] = p.avgBackOdds ?? p.avgLayOdds ?? 2; }
    setPx(init);
    const h = setInterval(() => setPx((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, Math.max(1.02, Math.round(v * (1 + (Math.random() - 0.5) * 0.03) * 100) / 100)]))), 2500);
    return () => clearInterval(h);
  }, [trades, enabled]);
  return px;
}

export function LiveTrading({ trades, liveEvents, isDemo, hasProvider }: { trades: Trade[]; liveEvents: LiveEvent[]; isDemo: boolean; hasProvider: boolean }) {
  const router = useRouter();
  const app = useAppData();
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status !== "open");
  const sim = useSimulatedPrices(open, isDemo);
  const [manual, setManual] = React.useState<Record<string, { back: string; lay: string }>>({});
  const [newTrade, setNewTrade] = React.useState<Partial<{ event: string; selection: string; sportId: string; odds: number; event_id: string }> | null>(null);
  const [exec, setExec] = React.useState<Trade | null>(null);
  const priceOf = (t: Trade) => {
    const m = manual[t.id];
    const back = m?.back ? Number(m.back) : isDemo ? sim[t.id] : t.price?.odds;
    const lay = m?.lay ? Number(m.lay) : back ? Math.round((back + Math.max(0.01, back * 0.01)) * 100) / 100 : undefined;
    return { back: back && back > 1 ? back : null, lay: lay && lay > 1 ? lay : null, simulated: isDemo && !m?.back };
  };
  let unreal = 0, exposure = 0;
  for (const t of open) {
    const p = position(t.executions); exposure += p.exposure;
    const g = greenUp(t.executions, priceOf(t)); if (g) unreal += g.lockedPnl;
  }
  const realized = closed.reduce((s, t) => s + (t.realized ?? 0), 0);
  const wins = closed.filter((t) => (t.realized ?? 0) > 0).length;
  const c = app.displayCurrency;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Live Trading" description="Back/lay positions with hedging, partial cash-outs and exchange commission. Position P/L is settled into the bankroll ledger."
        actions={<Button onClick={() => setNewTrade({})}><Plus className="h-3.5 w-3.5" /> New trade</Button>} />
      {isDemo && <Notice level="warn">DEMO: live prices on this page are a SIMULATED random walk, not market data.</Notice>}
      {!isDemo && !hasProvider && <Notice>No live data provider connected — enter current prices manually per position, or connect a provider with in-play odds under Settings → Data sources.</Notice>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Open positions" value={String(open.length)} />
        <Kpi label="Open exposure" value={fmtMoney(exposure, c)} tone={exposure ? "warn" : "neutral"} sub="worst case" />
        <Kpi label="Unrealised P/L" value={fmtMoney(unreal, c, true)} tone={toneOf(unreal)} sub="if greened up now" />
        <Kpi label="Realised P/L" value={fmtMoney(realized, c, true)} tone={toneOf(realized)} sub={`${closed.length} closed trades`} />
        <Kpi label="Winning trades" value={fmtPct(closed.length ? wins / closed.length : null)} />
        <Kpi label="Live events" value={String(liveEvents.length)} sub={isDemo ? "simulated" : hasProvider ? "from provider" : "no provider"} />
      </div>

      <Panel title="Open positions">
        {open.length === 0 ? <EmptyState title="No open trades">Open a trade from a live event below or with “New trade”.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-panel-2"><tr>{["Event / selection", "Opened", "Back (stake @ avg)", "Lay (stake @ avg)", "If wins", "If loses", "Exposure", "Price back / lay", "Green-up", "Unrealised", ""].map((h) => <th key={h} className="label-xs h-7 whitespace-nowrap px-2 text-left">{h}</th>)}</tr></thead>
              <tbody>{open.map((t) => {
                const p = position(t.executions), pr = priceOf(t), g = greenUp(t.executions, pr);
                return (
                  <tr key={t.id} className="border-b border-line/60 align-top">
                    <td className="px-2 py-1.5"><div className="font-medium">{t.event}</div><div className="text-muted">{t.market} · {t.selection}{t.bookmaker ? ` · ${t.bookmaker}` : ""}{t.commission ? ` · ${fmtPct(t.commission, 1)} comm.` : ""}</div></td>
                    <td className="num px-2 py-1.5 text-muted">{fmtDateTime(t.opened_at)}<div>{t.executions.length} exec.</div></td>
                    <td className="num px-2 py-1.5">{p.backStake ? `${fmtMoney(p.backStake, t.currency)} @ ${p.avgBackOdds?.toFixed(2)}` : "—"}{p.cashedStake ? <div className="text-warn">cashed {fmtMoney(p.cashedStake, t.currency)} for {fmtMoney(p.cashoutReceived, t.currency)}</div> : null}</td>
                    <td className="num px-2 py-1.5">{p.layStake ? `${fmtMoney(p.layStake, t.currency)} @ ${p.avgLayOdds?.toFixed(2)}` : "—"}</td>
                    <td className="px-2 py-1.5"><Money value={p.ifWin} ccy={t.currency} signed /></td>
                    <td className="px-2 py-1.5"><Money value={p.ifLose} ccy={t.currency} signed /></td>
                    <td className="px-2 py-1.5"><Money value={p.exposure} ccy={t.currency} /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <Input className="h-6 w-16" inputMode="decimal" placeholder={pr.back?.toFixed(2) ?? "back"} value={manual[t.id]?.back ?? ""} onChange={(e) => setManual((m) => ({ ...m, [t.id]: { back: e.target.value, lay: m[t.id]?.lay ?? "" } }))} aria-label="Current back price" />
                        <Input className="h-6 w-16" inputMode="decimal" placeholder={pr.lay?.toFixed(2) ?? "lay"} value={manual[t.id]?.lay ?? ""} onChange={(e) => setManual((m) => ({ ...m, [t.id]: { lay: e.target.value, back: m[t.id]?.back ?? "" } }))} aria-label="Current lay price" />
                      </div>
                      <div className="text-[10px] text-dim">{pr.simulated ? <Badge tone="demo" className="px-1 py-0 text-[9px]">SIMULATED</Badge> : t.price && !manual[t.id]?.back ? `${t.price.source} · ${fmtAgo(t.price.at)}` : manual[t.id]?.back ? "manual" : "enter price"}</div>
                    </td>
                    <td className="num px-2 py-1.5">{g?.side ? `${g.side.toUpperCase()} ${fmtMoney(g.stake, t.currency)} @ ${g.odds.toFixed(2)}` : g ? "flat" : "needs price"}</td>
                    <td className="px-2 py-1.5"><Money value={g?.lockedPnl ?? null} ccy={t.currency} signed /></td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <Button size="sm" variant="outline" onClick={() => setExec(t)}>Execute</Button>
                      <SettleMenu t={t} onDone={() => router.refresh()} />
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Live events" subtitle={isDemo ? "simulated" : "latest stored in-play prices"}>
        {liveEvents.length === 0 ? <p className="p-4 text-xs text-dim">{isDemo ? "No simulated live events right now." : hasProvider ? "No in-play events in stored data. Refresh your connection from the Odds Monitor." : "Connect a provider to see live events."}</p> : (
          <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 xl:grid-cols-3">{liveEvents.map((e) => (
            <div key={e.id} className="rounded-[3px] border border-line p-2 text-xs">
              <div className="flex items-center gap-1.5"><Activity className="live-dot h-3 w-3 text-up" /><b>{e.name}</b><span className="ml-auto text-dim">{e.sport}</span></div>
              {e.prices.map((p) => (
                <div key={p.name} className="mt-1 flex items-center gap-2"><span className="flex-1">{p.name}</span>
                  <span className={cn("num", p.move != null && p.move < 0 ? "text-up" : p.move != null && p.move > 0 ? "text-down" : "")}>{p.odds?.toFixed(2) ?? "—"}</span><span className="text-dim">{p.book} {fmtAgo(p.at)}</span>
                  <Button size="sm" variant="outline" disabled={!p.odds} onClick={() => setNewTrade({ event: e.name, selection: p.name, sportId: e.sportId, odds: p.odds ?? undefined, event_id: e.id })}>Trade</Button></div>
              ))}
            </div>
          ))}</div>
        )}
      </Panel>

      <Panel title="Trade history">
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-2"><tr>{["Opened", "Closed", "Event / selection", "Executions", "Outcome", "Realised P/L", "Notes"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{closed.map((t) => (
              <tr key={t.id} className="border-b border-line/60 align-top">
                <td className="num px-2 py-1.5 text-muted">{fmtDateTime(t.opened_at)}</td><td className="num px-2 py-1.5 text-muted">{fmtDateTime(t.closed_at)}</td>
                <td className="px-2 py-1.5">{t.event}<div className="text-muted">{t.selection}</div></td>
                <td className="px-2 py-1.5 text-muted">{t.executions.map((e, i) => <div key={i} className="num">{fmtDateTime(e.executedAt)} {e.side.toUpperCase()} {e.side === "cashout" ? `${e.stake} → ${e.amount}` : `${e.stake} @ ${e.odds}`}</div>)}</td>
                <td className="px-2 py-1.5"><Badge tone={t.outcome === "win" ? "up" : t.outcome === "lose" ? "down" : "neutral"}>{t.outcome}</Badge></td>
                <td className="px-2 py-1.5"><Money value={t.realized} ccy={t.currency} signed /></td>
                <td className="max-w-[240px] truncate px-2 py-1.5 text-muted">{t.notes}</td>
              </tr>
            ))}{!closed.length && <tr><td colSpan={7} className="py-6 text-center text-dim">No closed trades</td></tr>}</tbody>
          </table>
        </div>
      </Panel>
      {newTrade && <NewTradeDialog prefill={newTrade} onClose={() => setNewTrade(null)} />}
      {exec && <ExecutionDialog t={exec} price={priceOf(exec)} onClose={() => setExec(null)} />}
    </div>
  );
}

function SettleMenu({ t, onDone }: { t: Trade; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const go = async (o: "win" | "lose" | "void") => {
    const r = await settleTrade(t.id, o);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Trade settled: ${fmtMoney(Number(r.data), t.currency, true)}`); setOpen(false); onDone();
  };
  return (
    <>
      <Button size="sm" className="ml-1" onClick={() => setOpen(true)}>Settle</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Settle trade · ${t.selection}`} description="Commission is charged on positive net market P/L.">
          <div className="grid grid-cols-3 gap-2">
            {(["win", "lose", "void"] as const).map((o) => (
              <button key={o} onClick={() => go(o)} className="rounded-[3px] border border-line-strong p-3 text-left hover:border-accent">
                <div className="label-xs">Selection {o === "win" ? "won" : o === "lose" ? "lost" : "void"}</div>
                <div className="num text-base">{fmtMoney(settlePosition(t.executions, o, t.commission), t.currency, true)}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExecutionDialog({ t, price, onClose }: { t: Trade; price: { back: number | null; lay: number | null }; onClose: () => void }) {
  const router = useRouter();
  const g = greenUp(t.executions, price);
  const [f, setF] = React.useState<{ side: "back" | "lay" | "cashout"; odds: string; stake: string; amount: string; note: string }>({ side: g?.side ?? "lay", odds: String(g?.odds || price.lay || ""), stake: String(g?.stake || ""), amount: "", note: "" });
  const preview = (() => {
    try {
      const ex: Execution = f.side === "cashout" ? { side: "cashout", stake: Number(f.stake), amount: Number(f.amount) } : { side: f.side as "back" | "lay", odds: Number(f.odds), stake: Number(f.stake) };
      if (!(ex.stake > 0)) return null;
      return position([...t.executions, ex]);
    } catch { return null; }
  })();
  const submit = async () => {
    const r = await addExecution({ trade_id: t.id, side: f.side as "back" | "lay" | "cashout", odds: f.side === "cashout" ? undefined : Number(f.odds), stake: Number(f.stake), amount: f.side === "cashout" ? Number(f.amount) : undefined, note: f.note || undefined });
    if (!r.ok) return toast.error(r.error);
    toast.success("Execution recorded"); router.refresh(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Execute · ${t.event} — ${t.selection}`} description={g?.side ? `Suggested green-up: ${g.side} ${g.stake} @ ${g.odds} locks ${g.lockedPnl}` : "Enter a price to get a hedge suggestion"}>
        <div className="grid grid-cols-2 gap-2">
          <Label>Side<Select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as typeof f.side })}><option value="back">Back</option><option value="lay">Lay</option><option value="cashout">Cash-out (partial / full)</option></Select></Label>
          {f.side !== "cashout" ? <Label>Odds<Input inputMode="decimal" value={f.odds} onChange={(e) => setF({ ...f, odds: e.target.value })} /></Label>
            : <Label>Amount received<Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Label>}
          <Label>{f.side === "cashout" ? "Back stake closed" : "Stake"}<Input inputMode="decimal" value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} /></Label>
          <Label>Note<Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Label>
        </div>
        {preview && <p className="mt-2 text-xs text-muted">After execution: if wins <Money value={preview.ifWin} ccy={t.currency} signed /> · if loses <Money value={preview.ifLose} ccy={t.currency} signed /> · exposure <Money value={preview.exposure} ccy={t.currency} /></p>}
        <div className="mt-3 flex justify-end"><Button onClick={submit}>Record</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function NewTradeDialog({ prefill, onClose }: { prefill: Partial<{ event: string; selection: string; sportId: string; odds: number; event_id: string }>; onClose: () => void }) {
  const app = useAppData();
  const router = useRouter();
  const live = app.bankrolls.find((b) => b.kind === "live" && !b.archived) ?? app.bankrolls.find((b) => !b.archived);
  const [f, setF] = React.useState({ bankroll_id: live?.id ?? "", sport_id: prefill.sportId ?? app.sports[0]?.id ?? "", event_name: prefill.event ?? "", market: "Match Odds", selection: prefill.selection ?? "",
    bookmaker_id: app.bookmakers.find((b) => b.is_exchange)?.id ?? "", commission: String((app.bookmakers.find((b) => b.is_exchange)?.default_commission ?? 0) * 100), side: "back", odds: prefill.odds ? String(prefill.odds) : "", stake: "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const r = await openTrade({ ...f, side: f.side as "back" | "lay", odds: Number(f.odds), stake: Number(f.stake), commission: Number(f.commission) / 100, bookmaker_id: f.bookmaker_id || undefined, is_live: true } as never);
    if (!r.ok) return toast.error(r.error);
    toast.success("Trade opened"); router.refresh(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide title="New trade" description="Opens a position with its first execution. Add hedges, lays and cash-outs afterwards.">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Label>Bankroll<Select value={f.bankroll_id} onChange={set("bankroll_id")}>{app.bankrolls.filter((b) => !b.archived).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Label>
          <Label>Sport<Select value={f.sport_id} onChange={set("sport_id")}>{app.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Label>
          <Label className="col-span-2">Event<Input value={f.event_name} onChange={set("event_name")} /></Label>
          <Label>Market<Input value={f.market} onChange={set("market")} /></Label>
          <Label>Selection<Input value={f.selection} onChange={set("selection")} /></Label>
          <Label>Exchange / book<Select value={f.bookmaker_id} onChange={(e) => { const b = app.bookmakers.find((x) => x.id === e.target.value); setF({ ...f, bookmaker_id: e.target.value, commission: String((b?.default_commission ?? 0) * 100) }); }}><option value="">—</option>{app.bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Label>
          <Label>Commission %<Input inputMode="decimal" value={f.commission} onChange={set("commission")} /></Label>
          <Label>First execution<Select value={f.side} onChange={set("side")}><option value="back">Back</option><option value="lay">Lay</option></Select></Label>
          <Label>Odds<Input inputMode="decimal" value={f.odds} onChange={set("odds")} /></Label>
          <Label>Stake<Input inputMode="decimal" value={f.stake} onChange={set("stake")} /></Label>
          <Label className="col-span-2 md:col-span-4">Trading notes<Textarea value={f.notes} onChange={set("notes")} /></Label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={submit} disabled={!f.event_name || !f.selection || !f.odds || !f.stake}>Open trade</Button></div>
      </DialogContent>
    </Dialog>
  );
}
