"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useAppData } from "@/components/app/app-data";
import { betSchema } from "@/lib/schemas";
import { placeBet, updateBet } from "@/app/actions/bets";
import { accumulatorOdds, liability, potentialPayout } from "@/lib/finance/settlement";
import { expectedValuePerUnit, fullKellyFraction } from "@/lib/finance/staking";
import { parseOdds } from "@/lib/finance/odds";
import { CURRENCIES, fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Leg = { event_name: string; market: string; selection: string; line: string; odds: string; status: string };
export interface BetFormValues {
  bankroll_id: string; sport_id: string; league_id: string; is_live: boolean; side: "back" | "lay"; kind: "single" | "accumulator";
  home: string; away: string; event_name: string; event_start: string; placed_at: string;
  market_type_id: string; market: string; line: string; selection: string;
  bookmaker_id: string; odds: string; stake: string; currency: string; fx_rate: string; commission: string;
  est_probability: string; opening_odds: string; closing_odds: string; strategy_id: string; confidence: string; units: string;
  tags: string; correlation_group: string; notes: string;
  status: string; cashout_amount: string; settled_at: string;
  legs: Leg[];
}

const blankLeg = (): Leg => ({ event_name: "", market: "Match Winner", selection: "", line: "", odds: "", status: "pending" });
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const toLocal = (iso: string | null | undefined) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const s = (v: unknown) => (v == null ? "" : String(v));

export function BetFormDialog({ open, onOpenChange, prefill, existing }: {
  open: boolean; onOpenChange: (o: boolean) => void; prefill?: Record<string, unknown>; existing?: Record<string, unknown> & { id: string };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={existing ? `Edit bet #${s(existing.ref)}` : "New bet"}
        description={existing ? (existing.status !== "pending" ? "Settled: descriptive and analytics fields are editable. Reopen the bet to change stake or odds." : "Changing stake/odds re-reserves funds in the ledger.") : "Fast entry: Tab through, Enter to save. Press N anywhere to open."}>
        {open && <BetForm prefill={prefill} existing={existing} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function BetForm({ prefill, existing, onDone }: { prefill?: Record<string, unknown>; existing?: Record<string, unknown> & { id: string }; onDone: () => void }) {
  const app = useAppData();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [more, setMore] = React.useState(Boolean(existing));
  const src = existing ?? prefill ?? {};
  const activeBankrolls = app.bankrolls.filter((b) => !b.archived);
  const defaultBr = s(src.bankroll_id) || app.defaultBankrollId && activeBankrolls.find((b) => b.id === app.defaultBankrollId)?.id || activeBankrolls[0]?.id || "";
  const legsSrc = (src.bet_legs as Record<string, unknown>[] | undefined)?.sort((a, b) => Number(a.leg_no) - Number(b.leg_no));

  const form = useForm<BetFormValues>({
    defaultValues: {
      bankroll_id: defaultBr, sport_id: s(src.sport_id) || app.sports[0]?.id || "", league_id: s(src.league_id), is_live: Boolean(src.is_live),
      side: (src.side as "back" | "lay") ?? "back", kind: src.kind === "accumulator" ? "accumulator" : "single",
      home: s(src.home), away: s(src.away), event_name: s(src.event_name), event_start: toLocal(src.event_start as string), placed_at: existing ? toLocal(src.placed_at as string) : localNow(),
      market_type_id: s(src.market_type_id), market: s(src.market) || "Match Winner", line: s(src.line), selection: s(src.selection),
      bookmaker_id: s(src.bookmaker_id), odds: s(src.odds), stake: s(src.stake), currency: s(src.currency), fx_rate: existing && src.fx_rate !== 1 ? s(src.fx_rate) : "",
      commission: src.commission != null ? String(Number(src.commission) * 100) : "",
      est_probability: src.est_probability != null ? String(+(Number(src.est_probability) * 100).toFixed(2)) : "",
      opening_odds: s(src.opening_odds), closing_odds: s(src.closing_odds), strategy_id: s(src.strategy_id), confidence: s(src.confidence), units: s(src.units),
      tags: Array.isArray(src.tags) ? (src.tags as string[]).join(", ") : "", correlation_group: s(src.correlation_group), notes: s(src.notes),
      status: "pending", cashout_amount: "", settled_at: "",
      legs: legsSrc?.length ? legsSrc.map((l) => ({ event_name: s(l.event_name), market: s(l.market), selection: s(l.selection), line: s(l.line), odds: s(l.odds), status: "pending" })) : [blankLeg(), blankLeg()],
    },
  });
  const { register, watch, setValue, handleSubmit, setError, formState: { errors } } = form;
  const legs = useFieldArray({ control: form.control, name: "legs" });
  const v = watch();
  const bankroll = app.bankrolls.find((b) => b.id === v.bankroll_id);
  const ccy = v.currency || bankroll?.currency || app.displayCurrency;
  const sport = app.sports.find((x) => x.id === v.sport_id);
  const markets = app.marketTypes.filter((m) => !m.sport_id || m.sport_id === v.sport_id);
  const mt = app.marketTypes.find((m) => m.id === v.market_type_id);
  const leagues = app.leagues.filter((l) => l.sport_id === v.sport_id);
  const isAcca = v.kind === "accumulator";
  const settledEdit = Boolean(existing && existing.status !== "pending");

  // Auto-compose event name from teams.
  React.useEffect(() => {
    if (v.home && v.away && !existing) setValue("event_name", `${v.home} v ${v.away}`);
  }, [v.home, v.away, existing, setValue]);
  // Default commission from bookmaker.
  const onBookmaker = (id: string) => {
    setValue("bookmaker_id", id);
    const bk = app.bookmakers.find((b) => b.id === id);
    if (bk && !v.commission) setValue("commission", bk.default_commission ? String(+(bk.default_commission * 100).toFixed(3)) : "");
  };

  // Live preview (TS mirror of the SQL engine; the database is authoritative).
  const preview = React.useMemo(() => {
    try {
      const stake = Number(v.stake);
      const odds = isAcca ? accumulatorOdds(v.legs.map((l) => parseOdds(l.odds))).toNumber() : parseOdds(v.odds);
      if (!(stake > 0)) return { odds };
      const c = v.commission ? Number(v.commission) / 100 : 0;
      const p = v.est_probability ? Number(v.est_probability) / 100 : null;
      const liab = liability(v.side, odds, stake).toNumber();
      const payout = potentialPayout(v.side, odds, stake, c).toNumber();
      const ev = p && p > 0 && p < 1 && v.side === "back" ? expectedValuePerUnit(p, odds) * stake : null;
      const kelly = p && p > 0 && p < 1 && v.side === "back" ? fullKellyFraction(p, odds) : null;
      return { odds, liab, payout, profit: payout - liab, implied: 1 / odds, ev, edge: p != null ? p - 1 / odds : null, kelly };
    } catch { return null; }
  }, [v.stake, v.odds, v.legs, v.commission, v.est_probability, v.side, isAcca]);

  const kellyStake = preview?.kelly != null && bankroll ? Math.floor(bankroll.balance * preview.kelly * app.kellyFraction * 100) / 100 : null;

  const submit = handleSubmit(async (f) => {
    const num = (x: string) => (x.trim() === "" ? undefined : Number(x.replace(",", ".")));
    let odds: number | undefined;
    try { odds = isAcca ? undefined : f.odds ? parseOdds(f.odds) : undefined; } catch { setError("odds", { message: "Invalid odds" }); return; }
    const input = {
      client_ref: existing ? undefined : crypto.randomUUID(),
      bankroll_id: f.bankroll_id, sport_id: f.sport_id, league_id: f.league_id || undefined, is_live: f.is_live, side: f.side,
      event_name: f.event_name, home: f.home || undefined, away: f.away || undefined,
      event_start: f.event_start ? new Date(f.event_start).toISOString() : undefined,
      placed_at: f.placed_at ? new Date(f.placed_at).toISOString() : undefined,
      market_type_id: f.market_type_id || undefined, market_category: mt?.category, market: isAcca ? "Accumulator" : f.market,
      line: num(f.line), selection: isAcca ? `${f.legs.length}-fold` : f.selection, bookmaker_id: f.bookmaker_id || undefined,
      odds, stake: num(f.stake) as number, currency: f.currency || undefined, fx_rate: num(f.fx_rate),
      commission: f.commission ? Number(f.commission) / 100 : 0, est_probability: f.est_probability ? Number(f.est_probability) / 100 : undefined,
      opening_odds: num(f.opening_odds), closing_odds: num(f.closing_odds), strategy_id: f.strategy_id || undefined,
      confidence: num(f.confidence), units: num(f.units), tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      correlation_group: f.correlation_group || undefined, notes: f.notes || undefined,
      status: f.status as never, cashout_amount: num(f.cashout_amount), settled_at: f.settled_at ? new Date(f.settled_at).toISOString() : undefined,
      legs: isAcca ? f.legs.map((l) => ({ ...l, odds: (() => { try { return parseOdds(l.odds); } catch { return Number.NaN; } })(), line: num(l.line) })) : [],
    };
    const parsed = betSchema.safeParse(input);
    if (!parsed.success) {
      for (const i of parsed.error.issues) setError(i.path.join(".") as keyof BetFormValues, { message: i.message });
      toast.error(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setBusy(true);
    const res = existing ? await updateBet(existing.id, input as never) : await placeBet(input as never);
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(existing ? "Bet updated" : `Bet #${(res.data as { ref: number }).ref} saved`);
    router.refresh();
    onDone();
  });

  const err = (k: keyof BetFormValues) => <FieldError>{errors[k]?.message as string}</FieldError>;
  const outcomeButtons = [...(mt?.outcomes ?? []).map((o) => (o === "Home" ? v.home || "Home" : o === "Away" ? v.away || "Away" : o))].filter(Boolean);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); void submit(); } }}>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle value={v.kind} options={[["single", "Single"], ["accumulator", "Accumulator"]]} onChange={(x) => setValue("kind", x as "single" | "accumulator")} disabled={Boolean(existing)} />
        <Toggle value={v.is_live ? "live" : "pre"} options={[["pre", "Pre-match"], ["live", "Live"]]} onChange={(x) => setValue("is_live", x === "live")} />
        {!isAcca && <Toggle value={v.side} options={[["back", "Back"], ["lay", "Lay"]]} onChange={(x) => setValue("side", x as "back" | "lay")} disabled={settledEdit} />}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Label>Bankroll<Select {...register("bankroll_id")} disabled={settledEdit}>{activeBankrolls.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</Select>{err("bankroll_id")}</Label>
        <Label>Sport<Select {...register("sport_id")}>{app.sports.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Label>
        <Label>League<Select {...register("league_id")}><option value="">—</option>{leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Label>
        <Label>Placed at<Input type="datetime-local" {...register("placed_at")} /></Label>
      </div>

      {!isAcca ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Label>{sport?.key === "tennis" ? "Player 1" : "Home"}<Input {...register("home")} autoFocus={!existing} /></Label>
            <Label>{sport?.key === "tennis" ? "Player 2" : "Away"}<Input {...register("away")} /></Label>
            <Label className="col-span-2 md:col-span-1">Event<Input {...register("event_name")} placeholder="Home v Away" />{err("event_name")}</Label>
            <Label>Event start<Input type="datetime-local" {...register("event_start")} /></Label>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Label>Market
              <Select value={v.market_type_id} onChange={(e) => { const m = app.marketTypes.find((x) => x.id === e.target.value); setValue("market_type_id", e.target.value); if (m) setValue("market", m.name); }}>
                <option value="">Custom…</option>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Label>
            {!v.market_type_id && <Label>Market name<Input {...register("market")} />{err("market")}</Label>}
            {(mt?.has_line || !v.market_type_id) && <Label>Line<Input inputMode="decimal" {...register("line")} placeholder="-0.25" /></Label>}
            <Label className="col-span-2">Selection<Input {...register("selection")} />{err("selection")}
              {outcomeButtons.length > 0 && <span className="flex flex-wrap gap-1 normal-case tracking-normal">{outcomeButtons.map((o) => (
                <button type="button" key={o} className="rounded-[2px] border border-line-strong px-1.5 text-[10.5px] text-muted hover:text-fg"
                  onClick={() => setValue("selection", v.line ? `${o} ${Number(v.line) > 0 ? "+" : ""}${v.line}` : o)}>{o}</button>
              ))}</span>}
            </Label>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-[3px] border border-line p-2">
          <div className="label-xs">Legs</div>
          {legs.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_70px_28px] gap-1.5">
              <Input placeholder="Event" {...register(`legs.${i}.event_name`)} disabled={settledEdit} />
              <Input placeholder="Market" {...register(`legs.${i}.market`)} disabled={settledEdit} />
              <Input placeholder="Selection" {...register(`legs.${i}.selection`)} disabled={settledEdit} />
              <Input placeholder="Odds" inputMode="decimal" {...register(`legs.${i}.odds`)} disabled={settledEdit} />
              <Button type="button" variant="ghost" size="icon" onClick={() => legs.remove(i)} disabled={legs.fields.length <= 2 || settledEdit} aria-label="Remove leg"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!settledEdit && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => legs.append(blankLeg())}><Plus className="h-3 w-3" /> Leg</Button>}
          <div className="grid grid-cols-2 gap-2"><Label>Description<Input {...register("event_name")} placeholder="Saturday treble" />{err("event_name")}</Label></div>
          <FieldError>{(errors.legs as { message?: string } | undefined)?.message}</FieldError>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Label>Bookmaker<Select value={v.bookmaker_id} onChange={(e) => onBookmaker(e.target.value)}><option value="">—</option>{app.bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Label>
        {!isAcca && <Label>Odds {v.side === "lay" && "(lay)"}<Input inputMode="decimal" {...register("odds")} placeholder="2.10 / +110 / 11/10" disabled={settledEdit} />{err("odds")}</Label>}
        <Label>{v.side === "lay" ? "Backer's stake" : "Stake"}<Input inputMode="decimal" {...register("stake")} disabled={settledEdit} />{err("stake")}
          <span className="flex gap-1 normal-case tracking-normal">{[1, 2, 3].map((u) => <button type="button" key={u} disabled={settledEdit} className="rounded-[2px] border border-line-strong px-1 text-[10px] text-muted hover:text-fg" onClick={() => { setValue("stake", String(app.unitSize * u)); setValue("units", String(u)); }}>{u}u</button>)}
            {kellyStake != null && kellyStake > 0 && <button type="button" disabled={settledEdit} className="rounded-[2px] border border-accent/50 px-1 text-[10px] text-accent" onClick={() => setValue("stake", String(kellyStake))}>Kelly {kellyStake}</button>}</span>
        </Label>
        <Label>Currency<Select {...register("currency")} disabled={settledEdit}><option value="">{bankroll?.currency ?? "—"} (bankroll)</option>{CURRENCIES.filter((c) => c !== bankroll?.currency).map((c) => <option key={c}>{c}</option>)}</Select></Label>
        <Label>Commission %<Input inputMode="decimal" {...register("commission")} placeholder="0" disabled={settledEdit} />{err("commission")}</Label>
        {v.currency && v.currency !== bankroll?.currency && <Label>FX {v.currency}→{bankroll?.currency}<Input inputMode="decimal" {...register("fx_rate")} placeholder="from rates table" />{err("fx_rate")}</Label>}
      </div>

      {preview && "liab" in preview && (
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-line bg-line text-[11px] md:grid-cols-7">
          {[
            ["Odds", preview.odds?.toFixed(isAcca ? 3 : 2)],
            ["Implied", fmtPct(preview.implied)],
            [v.side === "lay" ? "Liability" : "Reserved", fmtMoney(preview.liab, ccy)],
            ["Payout", fmtMoney(preview.payout, ccy)],
            ["Profit if wins", fmtMoney(preview.profit, ccy)],
            ["EV", preview.ev == null ? "—" : fmtMoney(preview.ev, ccy, true)],
            ["Edge", preview.edge == null ? "—" : fmtPct(preview.edge, 1, true)],
          ].map(([k, val]) => <div key={k} className="bg-panel-2 px-2 py-1"><div className="label-xs">{k}</div><div className="num">{val}</div></div>)}
        </div>
      )}

      <button type="button" className="self-start text-[11px] text-accent" onClick={() => setMore((m) => !m)}>{more ? "− Hide" : "+ Show"} analytics, classification & settlement</button>
      {more && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Label>Est. probability %<Input inputMode="decimal" {...register("est_probability")} placeholder="55" />{err("est_probability")}</Label>
            <Label>Opening odds<Input inputMode="decimal" {...register("opening_odds")} />{err("opening_odds")}</Label>
            <Label>Closing odds<Input inputMode="decimal" {...register("closing_odds")} />{err("closing_odds")}</Label>
            <Label>Strategy<Select {...register("strategy_id")}><option value="">—</option>{app.strategies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Label>
            <Label>Confidence<Select {...register("confidence")}><option value="">—</option>{[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>{"★".repeat(c)}</option>)}</Select></Label>
            <Label>Units<Input inputMode="decimal" {...register("units")} /></Label>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Label>Tags (comma separated)<Input {...register("tags")} placeholder="value, steam" /></Label>
            <Label>Correlation group<Input {...register("correlation_group")} placeholder="e.g. epl-sat" /></Label>
            <Label className="col-span-2 md:col-span-1">Notes<Textarea rows={1} {...register("notes")} className="min-h-7" /></Label>
          </div>
          {!existing && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Label>Status (historical entry)
                <Select {...register("status")}>
                  {["pending", "won", "lost", "void", "half_won", "half_lost", "cashed_out"].map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
                </Select>{err("status")}
              </Label>
              {v.status === "cashed_out" && <Label>Cash-out amount<Input inputMode="decimal" {...register("cashout_amount")} />{err("cashout_amount")}</Label>}
              {v.status !== "pending" && <Label>Settled at<Input type="datetime-local" {...register("settled_at")} /></Label>}
              {isAcca && v.status !== "pending" && <p className="col-span-2 self-end text-[11px] text-muted">Accumulators are settled leg by leg after saving.</p>}
            </div>
          )}
        </>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-[10.5px] text-dim">Preview is computed locally; balances and profit are settled by the database.</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Save bet"}</Button>
        </div>
      </div>
    </form>
  );
}

export function Toggle({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex overflow-hidden rounded-[3px] border border-line-strong text-[11px]" role="radiogroup">
      {options.map(([k, l]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} disabled={disabled}
          className={cn("px-2.5 py-1 disabled:opacity-50", value === k ? "bg-accent text-white" : "text-muted hover:text-fg")} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export { Checkbox };
