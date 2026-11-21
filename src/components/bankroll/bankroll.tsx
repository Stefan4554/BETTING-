"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArrowLeftRight, CheckCircle2, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, FieldError, Input, Label, Select } from "@/components/ui/input";
import { KV, Money, Notice, PageHeader, Panel } from "@/components/app/primitives";
import { TimeSeries } from "@/components/charts/charts";
import { createBankroll, recordTransaction, transferFunds, updateBankroll, verifyBankroll } from "@/app/actions/finance";
import { CURRENCIES, fmtDateTime, fmtMoney, fmtPct, TX_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BankrollStats {
  id: string; name: string; kind: string; currency: string; archived: boolean; allowNegative: boolean;
  balance: number; reserved: number; tradeExposure: number; equity: number; available: number; openExposure: number; realizedOpenTrades: number;
  starting: number; deposits: number; withdrawals: number; transfers: number; adjustments: number; capital: number;
  totalStaked: number; totalReturn: number; netProfit: number; growth: number | null; peak: number;
  currentDrawdown: number; currentDrawdownPct: number | null; maxDrawdown: number; maxDrawdownPct: number | null;
  pendingBets: number; openTrades: number; series: { at: string; balance: number }[]; pnl: { at: string; cum: number }[];
}
type Tx = { id: number; bankroll_id: string; type: string; amount: number; balance_after: number; occurred_at: string; note: string | null; bet_id: string | null; trade_id: string | null; original: string | null };

export function BankrollView({ stats, transactions, sports }: { stats: BankrollStats[]; transactions: Tx[]; sports: { id: string; name: string }[] }) {
  const router = useRouter();
  const active = stats.filter((s) => !s.archived);
  const [sel, setSel] = React.useState(active[0]?.id ?? stats[0]?.id ?? "");
  const [dialog, setDialog] = React.useState<null | "new" | "deposit" | "withdrawal" | "adjustment" | "transfer">(null);
  const [txFilter, setTxFilter] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const cur = stats.find((s) => s.id === sel);
  const txs = transactions.filter((t) => t.bankroll_id === sel && (!txFilter || t.type === txFilter));
  const done = (msg: string) => { toast.success(msg); setDialog(null); router.refresh(); };

  const verify = async () => {
    const r = await verifyBankroll(sel);
    if (!r.ok) return toast.error(r.error);
    if (r.data.consistent) toast.success(`Ledger verified: cached balance ${r.data.cached} = sum of transactions ${r.data.ledger}`);
    else toast.error(`Mismatch! cached ${r.data.cached} vs ledger ${r.data.ledger}`);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Bankroll Manager" description="Ledger-based balances. Deposits, withdrawals, transfers and adjustments are capital flows and never count as betting profit."
        actions={<>
          <Button variant="outline" onClick={() => setDialog("transfer")} disabled={active.length < 2}><ArrowLeftRight className="h-3.5 w-3.5" /> Transfer</Button>
          <Button onClick={() => setDialog("new")}><Plus className="h-3.5 w-3.5" /> New bankroll</Button>
        </>} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stats.filter((s) => showArchived || !s.archived).map((s) => (
          <button key={s.id} onClick={() => setSel(s.id)} className={cn("rounded-[3px] border bg-panel p-3 text-left", sel === s.id ? "border-accent" : "border-line hover:border-line-strong", s.archived && "opacity-60")}>
            <div className="flex items-center justify-between"><span className="text-xs font-semibold">{s.name}</span><span className="label-xs">{s.kind} · {s.currency}{s.archived ? " · archived" : ""}</span></div>
            <div className="num mt-1 text-lg">{fmtMoney(s.equity, s.currency)}</div>
            <div className="flex justify-between text-[11px] text-muted"><span>cash {fmtMoney(s.balance, s.currency)}</span><span className={s.netProfit >= 0 ? "text-up" : "text-down"}>P/L {fmtMoney(s.netProfit, s.currency, true)}</span></div>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-muted"><Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>

      {cur && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel title={cur.name} subtitle={cur.currency} actions={<>
            <Button size="sm" onClick={() => setDialog("deposit")} disabled={cur.archived}><Plus className="h-3 w-3" /> Deposit</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("withdrawal")} disabled={cur.archived}><Minus className="h-3 w-3" /> Withdraw</Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("adjustment")} disabled={cur.archived} title="Adjustment"><SlidersHorizontal className="h-3 w-3" /></Button>
          </>} bodyClassName="p-3">
            {[
              ["Starting bankroll", fmtMoney(cur.starting, cur.currency)],
              ["Total bankroll (available + reserved)", fmtMoney(cur.equity, cur.currency)],
              ["Available bankroll (ledger cash)", fmtMoney(cur.available, cur.currency)],
              ["Reserved: open bets", `${fmtMoney(cur.reserved, cur.currency)} (${cur.pendingBets} bets)`],
              ["Reserved: open trades", `${fmtMoney(cur.tradeExposure, cur.currency)} (${cur.openTrades} trades)`],
              ["Open exposure (total reserved)", fmtMoney(cur.openExposure, cur.currency)],
              ["Realised on open trades (partial closes)", fmtMoney(cur.realizedOpenTrades, cur.currency, true)],
              ["Peak bankroll", fmtMoney(cur.peak, cur.currency)],
              ["Total deposits", fmtMoney(cur.deposits, cur.currency)],
              ["Total withdrawals", fmtMoney(cur.withdrawals, cur.currency)],
              ["Net transfers / adjustments", `${fmtMoney(cur.transfers, cur.currency, true)} / ${fmtMoney(cur.adjustments, cur.currency, true)}`],
              ["Total betting stake (settled)", fmtMoney(cur.totalStaked, cur.currency)],
              ["Total return (payouts)", fmtMoney(cur.totalReturn, cur.currency)],
              ["Net betting profit", <Money key="p" value={cur.netProfit} ccy={cur.currency} signed />],
              ["Bankroll growth (profit / net capital)", fmtPct(cur.growth, 2, true)],
              ["Current drawdown", `${fmtMoney(-cur.currentDrawdown, cur.currency)} (${fmtPct(cur.currentDrawdownPct)})`],
              ["Maximum drawdown", `${fmtMoney(-cur.maxDrawdown, cur.currency)} (${fmtPct(cur.maxDrawdownPct)})`],
            ].map(([k, v]) => <KV key={String(k)} k={k} v={v} />)}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={verify}><CheckCircle2 className="h-3 w-3" /> Verify ledger</Button>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await updateBankroll(cur.id, { archived: !cur.archived }); if (!r.ok) toast.error(r.error); else done(cur.archived ? "Restored" : "Archived"); }}>
                <Archive className="h-3 w-3" /> {cur.archived ? "Restore" : "Archive"}</Button>
              <Button size="sm" variant="ghost" onClick={async () => { const n = prompt("Rename bankroll", cur.name); if (n) { const r = await updateBankroll(cur.id, { name: n }); if (!r.ok) toast.error(r.error); else done("Renamed"); } }}>Rename</Button>
            </div>
          </Panel>
          <div className="flex flex-col gap-3 xl:col-span-2">
            <Panel title="Cash balance (ledger)" subtitle="balance after each transaction"><TimeSeries data={cur.series} series={[{ key: "balance", name: "Balance", color: "var(--s1)" }]} ccy={cur.currency} zeroLine={false} height={180} /></Panel>
            <Panel title="Cumulative betting P/L" subtitle="bets + trades, capital flows excluded"><TimeSeries data={cur.pnl} series={[{ key: "cum", name: "Cumulative P/L" }]} area ccy={cur.currency} height={180} /></Panel>
          </div>
        </div>
      )}

      <Panel title="Transactions" subtitle={cur ? `${cur.name} · newest first` : undefined} actions={
        <Select className="w-40" value={txFilter} onChange={(e) => setTxFilter(e.target.value)} aria-label="Transaction type"><option value="">All types</option>{Object.entries(TX_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      }>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-2"><tr>{["Time", "Type", "Amount", "Balance after", "Original", "Note"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{txs.map((t) => (
              <tr key={t.id} className="border-b border-line/60">
                <td className="num h-7 px-2 text-muted">{fmtDateTime(t.occurred_at)}</td>
                <td className="px-2">{TX_LABEL[t.type] ?? t.type}</td>
                <td className="px-2"><Money value={t.amount} ccy={cur?.currency ?? "EUR"} signed /></td>
                <td className="px-2"><Money value={t.balance_after} ccy={cur?.currency ?? "EUR"} /></td>
                <td className="num px-2 text-dim">{t.original ?? ""}</td>
                <td className="max-w-[320px] truncate px-2 text-muted">{t.note}{t.bet_id ? <a className="ml-1 text-accent" href={`/bets?bet=${t.bet_id}`}>bet</a> : null}</td>
              </tr>
            ))}{!txs.length && <tr><td colSpan={6} className="py-8 text-center text-dim">No transactions</td></tr>}</tbody>
          </table>
        </div>
      </Panel>

      {dialog === "new" && <NewBankroll sports={sports} onClose={() => setDialog(null)} onDone={() => done("Bankroll created")} />}
      {(dialog === "deposit" || dialog === "withdrawal" || dialog === "adjustment") && cur && <TxDialog kind={dialog} bankroll={cur} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "transfer" && <TransferDialog bankrolls={active} onClose={() => setDialog(null)} onDone={() => done("Transfer complete")} />}
      {!stats.length && <Notice>No bankrolls yet — create one to start.</Notice>}
    </div>
  );
}

function NewBankroll({ sports, onClose, onDone }: { sports: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = React.useState({ name: "", currency: "EUR", kind: "custom", sport_id: "", opening_deposit: "", allow_negative: false });
  const [err, setErr] = React.useState<Record<string, string>>({});
  const submit = async () => {
    const r = await createBankroll({ ...f, opening_deposit: f.opening_deposit || undefined, sport_id: f.sport_id || undefined } as never);
    if (!r.ok) { setErr(r.fieldErrors ?? {}); return toast.error(r.error); }
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New bankroll" description="Separate bankrolls for sports, live trading or bookmaker accounts. Each has its own ledger and currency.">
        <div className="grid grid-cols-2 gap-2">
          <Label className="col-span-2">Name<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Football bankroll" /><FieldError>{err.name}</FieldError></Label>
          <Label>Currency<Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Label>
          <Label>Type<Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="main">Main</option><option value="sport">Sport</option><option value="live">Live trading</option><option value="custom">Custom</option></Select></Label>
          {f.kind === "sport" && <Label>Sport<Select value={f.sport_id} onChange={(e) => setF({ ...f, sport_id: e.target.value })}><option value="">—</option>{sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Label>}
          <Label>Opening deposit<Input inputMode="decimal" value={f.opening_deposit} onChange={(e) => setF({ ...f, opening_deposit: e.target.value })} /><FieldError>{err.opening_deposit}</FieldError></Label>
          <label className="col-span-2 flex items-center gap-1.5 text-xs"><Checkbox checked={f.allow_negative} onChange={(e) => setF({ ...f, allow_negative: e.target.checked })} /> Allow negative balance (credit accounts)</label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={submit} disabled={!f.name}>Create</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function TxDialog({ kind, bankroll, onClose, onDone }: { kind: "deposit" | "withdrawal" | "adjustment"; bankroll: BankrollStats; onClose: () => void; onDone: (m: string) => void }) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [at, setAt] = React.useState("");
  const [err, setErr] = React.useState<Record<string, string>>({});
  const submit = async () => {
    const r = await recordTransaction({ bankroll_id: bankroll.id, type: kind, amount: Number(amount.replace(",", ".")), note: note || undefined, occurred_at: at || undefined });
    if (!r.ok) { setErr(r.fieldErrors ?? {}); return toast.error(r.error); }
    onDone(`${TX_LABEL[kind]} recorded`);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${TX_LABEL[kind]} · ${bankroll.name}`} description={kind === "adjustment" ? "Signed amount (negative reduces the balance). A note is required. Adjustments are capital flows, not profit." : `Amount in ${bankroll.currency}. Not counted as betting profit.`}>
        <div className="grid grid-cols-2 gap-2">
          <Label>Amount ({bankroll.currency})<Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><FieldError>{err.amount}</FieldError></Label>
          <Label>Date (optional)<Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Label>
          <Label className="col-span-2">Note<Input value={note} onChange={(e) => setNote(e.target.value)} /><FieldError>{err.note}</FieldError></Label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={submit} disabled={!amount}>Record</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ bankrolls, onClose, onDone }: { bankrolls: BankrollStats[]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = React.useState(bankrolls[0]?.id ?? "");
  const [to, setTo] = React.useState(bankrolls[1]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const [fx, setFx] = React.useState("");
  const a = bankrolls.find((b) => b.id === from), b = bankrolls.find((x) => x.id === to);
  const cross = a && b && a.currency !== b.currency;
  const submit = async () => {
    const r = await transferFunds({ from, to, amount: Number(amount), fx_rate: fx ? Number(fx) : undefined });
    if (!r.ok) return toast.error(r.error);
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Transfer between bankrolls" description="Posted as a linked transfer-out / transfer-in pair in one database transaction.">
        <div className="grid grid-cols-2 gap-2">
          <Label>From<Select value={from} onChange={(e) => setFrom(e.target.value)}>{bankrolls.map((x) => <option key={x.id} value={x.id}>{x.name} ({fmtMoney(x.balance, x.currency)})</option>)}</Select></Label>
          <Label>To<Select value={to} onChange={(e) => setTo(e.target.value)}>{bankrolls.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</Select></Label>
          <Label>Amount ({a?.currency})<Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Label>
          {cross && <Label>Rate 1 {a?.currency} = ? {b?.currency}<Input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="latest stored rate" /></Label>}
        </div>
        {cross && amount && fx && <p className="mt-2 text-xs text-muted">{b?.name} receives {fmtMoney(Number(amount) * Number(fx), b!.currency)}</p>}
        <div className="mt-3 flex justify-end"><Button onClick={submit} disabled={!amount || from === to}>Transfer</Button></div>
      </DialogContent>
    </Dialog>
  );
}
