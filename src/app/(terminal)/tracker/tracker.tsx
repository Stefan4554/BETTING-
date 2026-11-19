"use client";
import Link from "next/link";
import { useState } from "react";
import type { Bet, BetStatus } from "@/lib/engine/bets";
import { betProfit, betsToCsv, summarize } from "@/lib/engine/bets";
import { closingLineValue } from "@/lib/engine/odds";
import type { BetStorage } from "@/lib/data/bets";
import { fmtDateTime, fmtMoney, fmtOdds, fmtPct, MARKET_LABEL } from "@/lib/format";
import { EmptyState, Missing, Panel, StatTile } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadText, useBets, useSettings } from "@/components/portfolio/hooks";
import { cn } from "@/lib/utils";

const STATUSES: BetStatus[] = ["pending", "won", "lost", "void", "half_won", "half_lost", "cashed_out"];
const STORAGE_NOTE: Record<BetStorage, string> = {
  demo: "Demo mode: sample bet history (fictional). Your changes are kept in this browser only.",
  local: "Supabase is not configured, so bets are stored in this browser only. Configure Supabase to sync them to your account.",
  supabase: "Bets are stored in your account (row-level security: only you can read them).",
};

export function Tracker({ storage, initial, signedIn }: { storage: BetStorage; initial: Bet[]; signedIn: boolean }) {
  const { bets, add, update, remove, error, busy, reset } = useBets(storage, initial);
  const [settings] = useSettings();
  const [form, setForm] = useState({ eventLabel: "", market: "match_winner", selection: "", bookmaker: "", odds: "", stake: "", closingOdds: "", status: "pending" as BetStatus, notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"" | BetStatus>("");
  const s = summarize(bets, settings.bankroll);

  if (storage === "supabase" && !signedIn) {
    return <Panel><EmptyState title="Sign in to track bets"><Link href="/login?next=/tracker" className="text-accent">Sign in</Link> — bets are stored privately in your account.</EmptyState></Panel>;
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const odds = Number(form.odds), stake = Number(form.stake), close = form.closingOdds ? Number(form.closingOdds) : null;
    if (!form.eventLabel.trim() || !form.selection.trim() || !form.bookmaker.trim()) return setFormError("Match, selection and bookmaker are required.");
    if (!(odds > 1)) return setFormError("Odds must be decimal and greater than 1.00.");
    if (!(stake > 0)) return setFormError("Stake must be positive.");
    if (close !== null && !(close > 1)) return setFormError("Closing odds must be greater than 1.00.");
    setFormError(null);
    add({ placedAt: new Date().toISOString(), settledAt: form.status === "pending" ? null : new Date().toISOString(), sport: "tennis", eventLabel: form.eventLabel.trim(), market: form.market, selection: form.selection.trim(), bookmaker: form.bookmaker.trim(), odds, stake, closingOdds: close, status: form.status, notes: form.notes || null });
    setForm({ ...form, eventLabel: "", selection: "", odds: "", stake: "", closingOdds: "", notes: "", status: "pending" });
  };
  const exportCsv = () => (storage === "supabase" ? (window.location.href = "/api/bets/export") : downloadText(`edge-bets-${new Date().toISOString().slice(0, 10)}.csv`, betsToCsv(bets)));
  const shown = filter ? bets.filter((b) => b.status === filter) : bets;

  return (
    <>
      <div className="rounded-[3px] border border-line-strong bg-panel-2 px-3 py-1.5 text-xs text-muted">{STORAGE_NOTE[storage]} {reset && <button onClick={reset} className="ml-2 text-accent">Reset demo data</button>}</div>
      {error && <div className="rounded-[3px] border border-down/40 bg-down-soft px-3 py-1.5 text-xs text-down">{error}</div>}
      <Panel bodyClassName="grid grid-cols-3 md:grid-cols-9">
        <StatTile label="Bets" value={s.bets} sub={`${s.pending} pending`} />
        <StatTile label="Staked" value={fmtMoney(s.totalStaked, settings.currency)} sub="settled" />
        <StatTile label="Profit" value={fmtMoney(s.profit, settings.currency)} tone={s.profit >= 0 ? "up" : "down"} />
        <StatTile label="Yield" value={fmtPct(s.yield, 2, true)} tone={s.yield >= 0 ? "up" : "down"} sub="profit / stake" />
        <StatTile label="ROI" value={fmtPct(s.roi, 2, true)} tone={(s.roi ?? 0) >= 0 ? "up" : "down"} sub={`on ${fmtMoney(settings.bankroll, settings.currency)} bank`} />
        <StatTile label="Win rate" value={fmtPct(s.winRate)} sub="excl. voids" />
        <StatTile label="Avg odds" value={fmtOdds(s.averageOdds)} />
        <StatTile label="Avg CLV" value={s.averageClv == null ? <Missing reason="Record closing odds to measure CLV" /> : fmtPct(s.averageClv, 2, true)} tone={(s.averageClv ?? 0) >= 0 ? "up" : "down"} sub={`${s.clvSample} with close`} />
        <StatTile label="Settled" value={s.settled} />
      </Panel>

      <Panel title="Add bet">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 p-3">
          <Label className="w-56">Match / event<Input value={form.eventLabel} onChange={(e) => setForm({ ...form, eventLabel: e.target.value })} placeholder="Player A v Player B" maxLength={200} /></Label>
          <Label>Market<Select value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })}>{Object.entries(MARKET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Label>
          <Label className="w-40">Selection<Input value={form.selection} onChange={(e) => setForm({ ...form, selection: e.target.value })} maxLength={120} /></Label>
          <Label className="w-36">Bookmaker<Input value={form.bookmaker} onChange={(e) => setForm({ ...form, bookmaker: e.target.value })} maxLength={80} /></Label>
          <Label className="w-20">Odds<Input inputMode="decimal" value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })} placeholder="2.10" /></Label>
          <Label className="w-24">Stake<Input inputMode="decimal" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} placeholder="10" /></Label>
          <Label className="w-24">Closing odds<Input inputMode="decimal" value={form.closingOdds} onChange={(e) => setForm({ ...form, closingOdds: e.target.value })} placeholder="optional" /></Label>
          <Label>Status<Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BetStatus })}>{STATUSES.filter((x) => x !== "cashed_out").map((x) => <option key={x}>{x}</option>)}</Select></Label>
          <Label className="w-48">Notes<Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={1000} /></Label>
          <Button type="submit" disabled={busy}>Add bet</Button>
          {formError && <span className="text-xs text-down">{formError}</span>}
        </form>
      </Panel>

      <Panel title="Bets" subtitle={`${shown.length}`} actions={<><Select value={filter} onChange={(e) => setFilter(e.target.value as BetStatus | "")}><option value="">All statuses</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</Select><Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button></>}>
        {shown.length === 0 ? <EmptyState icon="info" title="No bets recorded yet" /> : (
          <Table>
            <THead><TR><TH>Placed</TH><TH>Event</TH><TH>Market</TH><TH>Selection</TH><TH>Book</TH><TH className="text-right">Odds</TH><TH className="text-right">Stake</TH><TH className="text-right">Close</TH><TH className="text-right">CLV</TH><TH>Status</TH><TH className="text-right">P/L</TH><TH /></TR></THead>
            <tbody>
              {shown.slice(0, 500).map((b) => {
                const p = betProfit(b);
                return (
                  <TR key={b.id}>
                    <TD className="num text-muted">{fmtDateTime(b.placedAt)}</TD>
                    <TD className="max-w-56 truncate">{b.eventLabel}</TD>
                    <TD className="text-muted">{MARKET_LABEL[b.market] ?? b.market}</TD>
                    <TD>{b.selection}</TD>
                    <TD className="text-muted">{b.bookmaker}</TD>
                    <TD className="num text-right">{fmtOdds(b.odds)}</TD>
                    <TD className="num text-right">{b.stake.toFixed(2)}</TD>
                    <TD className="num text-right">{b.closingOdds ? fmtOdds(b.closingOdds) : <Missing reason="No closing odds recorded" />}</TD>
                    <TD className="num text-right">{b.closingOdds ? fmtPct(closingLineValue(b.odds, b.closingOdds), 1, true) : <Missing />}</TD>
                    <TD>
                      <Select value={b.status} onChange={(e) => update(b.id, { status: e.target.value as BetStatus })} className="h-6">
                        {STATUSES.filter((x) => x !== "cashed_out" || b.status === "cashed_out").map((x) => <option key={x}>{x}</option>)}
                      </Select>
                    </TD>
                    <TD className={cn("num text-right", p == null ? "text-muted" : p >= 0 ? "text-up" : "text-down")}>{p == null ? "—" : p.toFixed(2)}</TD>
                    <TD><button className="text-[11px] text-dim hover:text-down" onClick={() => remove(b.id)} aria-label="Delete bet">✕</button></TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
