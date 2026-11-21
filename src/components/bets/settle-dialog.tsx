"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { partialCashout, setLegResults, settleBet } from "@/app/actions/bets";
import { accumulatorComponents, asianHandicapResult, betProfit, settleAccumulator, totalsResult, type BetStatus, type LegStatus } from "@/lib/finance/settlement";
import { fmtMoney, STATUS_LABEL } from "@/lib/format";
import type { BetView } from "./tracker";
import { cn } from "@/lib/utils";

const RESULTS: BetStatus[] = ["won", "lost", "void", "half_won", "half_lost"];

export function SettleDialog({ bet, onClose }: { bet: BetView; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<BetStatus>("won");
  const [closing, setClosing] = React.useState(bet.closing_odds ? String(bet.closing_odds) : "");
  const [cash, setCash] = React.useState("");
  const [portion, setPortion] = React.useState("");
  const [legs, setLegs] = React.useState<LegStatus[]>(bet.legs.map((l) => (l.status as LegStatus) ?? "pending"));
  const [score, setScore] = React.useState({ a: "", b: "" });
  const [busy, setBusy] = React.useState(false);
  const isAcca = bet.kind === "accumulator";
  const open = bet.stake - bet.cashed_out_stake;

  const preview = React.useMemo(() => {
    try {
      if (isAcca) {
        const r = settleAccumulator(bet.legs.map((l, i) => ({ odds: l.odds, status: legs[i]! })));
        if (r.status === "pending") return null;
        return { status: r.status, profit: betProfit({ side: "back", odds: bet.odds, stake: bet.stake, commission: bet.commission, status: r.status, factor: r.factor ?? undefined, cashedOutStake: bet.cashed_out_stake, cashoutAmount: bet.cashout_amount })!.toNumber() };
      }
      return { status, profit: betProfit({ side: bet.side, odds: bet.odds, stake: bet.stake, commission: bet.commission, status, cashedOutStake: bet.cashed_out_stake, cashoutAmount: bet.cashout_amount })!.toNumber() };
    } catch { return null; }
  }, [status, legs, bet, isAcca]);

  // Asian handicap / totals helper: derive the result from the final score.
  const derive = () => {
    const a = Number(score.a), b = Number(score.b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || score.a === "" || score.b === "" || bet.line == null) return;
    try {
      const sel = bet.selection.toLowerCase();
      let r: LegStatus;
      if (/over|under/.test(sel) || bet.market_category === "totals") r = totalsResult(sel.includes("under") ? "under" : "over", bet.line, a + b);
      else {
        const isAway = bet.away && sel.includes(bet.away.toLowerCase());
        r = isAway ? asianHandicapResult(bet.line, b, a) : asianHandicapResult(bet.line, a, b);
      }
      setStatus(bet.side === "lay" ? ({ won: "lost", lost: "won", half_won: "half_lost", half_lost: "half_won", void: "void", pending: "pending" } as const)[r] : r);
      toast.message(`Result from score ${a}-${b} on line ${bet.line}: ${STATUS_LABEL[r]}`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const done = (msg: string) => { toast.success(msg); router.refresh(); onClose(); };
  const settle = async () => {
    setBusy(true);
    if (isAcca) {
      const r = await setLegResults(bet.id, legs.map((st, i) => ({ leg_no: bet.legs[i]!.leg_no, status: st })));
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      if (r.data.status === "pending") { toast.success("Leg results saved; accumulator still open"); router.refresh(); return onClose(); }
      return done(`Settled ${STATUS_LABEL[r.data.status]} · P/L ${fmtMoney(r.data.profit == null ? null : Number(r.data.profit), bet.currency, true)}`);
    }
    const r = await settleBet({
      bet_id: bet.id, status: isAcca ? undefined : (status as "won" | "lost" | "void" | "half_won" | "half_lost"), closing_odds: closing ? Number(closing) : undefined,
      legs: isAcca ? legs.map((s, i) => ({ leg_no: bet.legs[i]!.leg_no, status: s })) : undefined,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    done(`Settled · P/L ${fmtMoney(r.data.profit == null ? null : Number(r.data.profit), bet.currency, true)}`);
  };
  const cashOut = async (full: boolean) => {
    setBusy(true);
    const r = full
      ? await settleBet({ bet_id: bet.id, status: "cashed_out", cashout_amount: Number(cash), closing_odds: closing ? Number(closing) : undefined })
      : await partialCashout(bet.id, Number(portion), Number(cash));
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    done(full ? "Cashed out" : "Partial cash-out recorded");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Settle bet #${bet.ref}`} description={`${bet.event_name} — ${bet.selection} @ ${bet.odds} · stake ${fmtMoney(bet.stake, bet.currency)}${bet.cashed_out_stake ? ` (${fmtMoney(open, bet.currency)} open)` : ""}`}>
        <Tabs defaultValue="result">
          <TabsList><TabsTrigger value="result">Result</TabsTrigger>{bet.side === "back" && <TabsTrigger value="cashout">Cash-out</TabsTrigger>}</TabsList>
          <TabsContent value="result" className="flex flex-col gap-3">
            {isAcca ? (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-muted">Leg results can be saved one at a time. The accumulator settles automatically when a leg loses or every leg is decided; its result follows the actual payout.</p>
                {bet.legs.map((l, i) => (
                  <div key={l.leg_no} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{l.event_name} — {l.selection} @ {l.odds}</span>
                    <Select className="w-28" value={legs[i]} onChange={(e) => setLegs((x) => x.map((v, j) => (j === i ? (e.target.value as LegStatus) : v)))}>
                      {(["pending", "won", "lost", "void", "half_won", "half_lost"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {RESULTS.map((s) => (
                    <button key={s} onClick={() => setStatus(s)} className={cn("rounded-[3px] border px-3 py-1.5 text-xs", status === s ? "border-accent bg-accent-soft text-fg" : "border-line-strong text-muted hover:text-fg")}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
                {bet.line != null && (
                  <div className="flex items-end gap-2 rounded-[3px] border border-line p-2">
                    <Label>{bet.home ?? "Home"} score<Input inputMode="numeric" value={score.a} onChange={(e) => setScore((s) => ({ ...s, a: e.target.value }))} className="w-20" /></Label>
                    <Label>{bet.away ?? "Away"} score<Input inputMode="numeric" value={score.b} onChange={(e) => setScore((s) => ({ ...s, b: e.target.value }))} className="w-20" /></Label>
                    <Button variant="outline" onClick={derive}>Derive result (line {bet.line})</Button>
                  </div>
                )}
              </>
            )}
            {isAcca && preview && legs.every((x) => x !== "pending") && <AccaBreakdown stake={bet.stake - bet.cashed_out_stake} legs={bet.legs.map((l, i) => ({ odds: l.odds, status: legs[i]! }))} currency={bet.currency} />}
            {!isAcca && <Label>Closing odds (optional, for CLV)<Input inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} className="w-32" /></Label>}
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className="text-xs text-muted">Preview: {preview ? <><b>{STATUS_LABEL[preview.status]}</b> · P/L <span className={cn("num", preview.profit >= 0 ? "text-up" : "text-down")}>{fmtMoney(preview.profit, bet.currency, true)}</span></> : "legs still open"}</span>
              <Button onClick={settle} disabled={busy || (!preview && !isAcca)}>{isAcca && !preview ? "Save leg results" : "Confirm settlement"}</Button>
            </div>
          </TabsContent>
          <TabsContent value="cashout" className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Label>Cash-out amount received<Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></Label>
              <Label>Stake portion (partial only)<Input inputMode="decimal" value={portion} onChange={(e) => setPortion(e.target.value)} placeholder={`< ${open}`} /></Label>
            </div>
            <p className="text-[11px] text-muted">Full cash-out closes the bet (P/L = total cash-outs − stake). A partial cash-out credits the amount now and keeps the remaining stake running.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy || !cash || !portion} onClick={() => cashOut(false)}>Record partial</Button>
              <Button disabled={busy || !cash} onClick={() => cashOut(true)}>Full cash-out</Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccaBreakdown({ stake, legs, currency }: { stake: number; legs: { odds: number; status: LegStatus }[]; currency: string }) {
  const comps = accumulatorComponents(stake, legs);
  const total = comps.reduce((a, c) => a + c.payout.toNumber(), 0);
  return (
    <div className="rounded-[3px] border border-line p-2 text-[11px]">
      <div className="label-xs mb-1">Settlement components (half results split the stake)</div>
      {comps.map((c, i) => (
        <div key={i} className="num flex justify-between"><span className="text-muted">{c.path.join(" × ")}</span><span>{fmtMoney(c.stake.toNumber(), currency)} @ {c.odds.toFixed(3)} → {fmtMoney(c.payout.toNumber(), currency)}</span></div>
      ))}
      <div className="num mt-1 flex justify-between border-t border-line pt-1"><span>Total payout vs stake {fmtMoney(stake, currency)}</span><b>{fmtMoney(total, currency)} ({fmtMoney(total - stake, currency, true)})</b></div>
    </div>
  );
}
