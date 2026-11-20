"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { KV, Money, StatusBadge } from "@/components/app/primitives";
import { addBetNote, getBetDetail } from "@/app/actions/bets";
import { clv, marketMovement, type ClvConvention } from "@/lib/finance/clv";
import { fmtDateTime, fmtPct, fmtPp, MISSING, STATUS_LABEL, TX_LABEL } from "@/lib/format";
import type { BetView } from "./tracker";

type Detail = { notes: { id: string; body: string; created_at: string }[]; transactions: { id: number; type: string; amount: number; balance_after: number; occurred_at: string; note: string | null }[]; audit: { id: number; action: string; at: string; actor: string }[] };

export function BetDetail({ bet: b, convention, onClose, onEdit, onSettle }: { bet: BetView; convention: ClvConvention; onClose: () => void; onEdit: () => void; onSettle: () => void }) {
  const router = useRouter();
  const [d, setD] = React.useState<Detail | null>(null);
  const [note, setNote] = React.useState("");
  const load = React.useCallback(async () => { const r = await getBetDetail(b.id); if (r.ok) setD(r.data as unknown as Detail); }, [b.id]);
  React.useEffect(() => { void load(); }, [load]);
  const c = clv(b.odds, b.closing_odds, convention, b.side);
  const ccy = b.currency;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide title={`Bet #${b.ref} · ${STATUS_LABEL[b.status]}`} description={`${b.event_name} · ${b.market} · ${b.selection}`}>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="label-xs mb-1">Identification</div>
            <KV k="Placed" v={fmtDateTime(b.placed_at)} /><KV k="Event start" v={fmtDateTime(b.event_start)} /><KV k="Sport / league" v={`${b.sport}${b.league ? " · " + b.league : ""}`} />
            <KV k="Timing" v={b.is_live ? "Live" : "Pre-match"} /><KV k="Market" v={`${b.market}${b.line != null ? ` (${b.line})` : ""}`} /><KV k="Side" v={b.side} /><KV k="Bookmaker" v={b.bookmaker ?? MISSING} />
          </div>
          <div>
            <div className="label-xs mb-1">Financial ({ccy})</div>
            <KV k="Odds" v={b.odds.toFixed(b.kind === "accumulator" ? 3 : 2)} /><KV k="Stake" v={<Money value={b.stake} ccy={ccy} />} />
            <KV k={b.side === "lay" ? "Liability" : "Reserved"} v={<Money value={b.liability} ccy={ccy} />} /><KV k="Commission" v={fmtPct(b.commission)} />
            <KV k="Potential payout" v={<Money value={b.potential_payout} ccy={ccy} />} /><KV k="Actual payout" v={<Money value={b.actual_payout} ccy={ccy} />} />
            <KV k="Cash-outs" v={b.cashout_amount ? <><Money value={b.cashout_amount} ccy={ccy} /> for <Money value={b.cashed_out_stake} ccy={ccy} /> stake</> : MISSING} />
            <KV k="Net P/L" v={<Money value={b.profit} ccy={ccy} signed />} /><KV k="FX to bankroll" v={b.fx_rate === 1 ? "—" : `${b.fx_rate} (locked)`} /><KV k="Bankroll" v={b.bankroll} />
          </div>
          <div>
            <div className="label-xs mb-1">Analytics</div>
            <KV k="Implied probability" v={fmtPct(1 / b.odds)} /><KV k="Estimated probability" v={fmtPct(b.est_probability)} />
            <KV k="Edge" v={b.est_probability != null ? fmtPct(b.est_probability - 1 / b.odds, 2, true) : MISSING} />
            <KV k="EV" v={b.est_probability != null && b.side === "back" ? <Money value={b.stake * (b.est_probability * (b.odds - 1) - (1 - b.est_probability))} ccy={ccy} signed /> : MISSING} />
            <KV k="Opening / closing" v={`${b.opening_odds?.toFixed(2) ?? MISSING} / ${b.closing_odds?.toFixed(2) ?? MISSING}`} />
            <KV k="Closing source" v={b.closing_source ?? MISSING} />
            <KV k={`CLV (${convention})`} v={convention === "odds" ? fmtPct(c, 2, true) : fmtPp(c)} />
            <KV k="Market move open→close" v={fmtPct(marketMovement(b.opening_odds, b.closing_odds), 1, true)} />
            <KV k="Strategy" v={b.strategy ?? MISSING} /><KV k="Tags" v={b.tags.join(", ") || MISSING} /><KV k="Correlation group" v={b.correlation_group ?? MISSING} />
          </div>
        </div>
        {b.legs.length > 0 && (
          <div className="mt-4"><div className="label-xs mb-1">Legs</div>
            {b.legs.map((l) => <KV key={l.leg_no} k={`${l.leg_no}. ${l.event_name} — ${l.selection}`} v={<>{l.odds.toFixed(2)} · {STATUS_LABEL[l.status]}</>} />)}
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="label-xs mb-1">Ledger entries</div>
            {d?.transactions.map((t) => <KV key={t.id} k={`${fmtDateTime(t.occurred_at)} · ${TX_LABEL[t.type]}`} v={<>{Number(t.amount).toFixed(2)} → {Number(t.balance_after).toFixed(2)}</>} />) ?? <p className="text-xs text-dim">Loading…</p>}
            <div className="label-xs mb-1 mt-3">Audit trail</div>
            {d?.audit.map((a) => <KV key={a.id} k={fmtDateTime(a.at)} v={`${a.action} (${a.actor})`} />)}
          </div>
          <div>
            <div className="label-xs mb-1">Notes</div>
            {b.notes && <p className="mb-1 whitespace-pre-wrap rounded bg-panel-2 p-2 text-xs">{b.notes}</p>}
            {d?.notes.map((n) => <p key={n.id} className="mb-1 rounded bg-panel-2 p-2 text-xs"><span className="text-dim">{fmtDateTime(n.created_at)} · </span>{n.body}</p>)}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a timestamped note…" />
            <Button size="sm" className="mt-1" disabled={!note.trim()} onClick={async () => { const r = await addBetNote(b.id, note); if (!r.ok) toast.error(r.error); else { setNote(""); void load(); } }}>Add note</Button>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onEdit}>Edit</Button>
          {b.status === "pending" && <Button onClick={onSettle}>Settle</Button>}
          <Button variant="ghost" onClick={() => { router.refresh(); onClose(); }}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
