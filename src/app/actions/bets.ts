"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { evaluateRiskAlerts } from "@/lib/server/alerts";
import { betSchema, settleSchema, type BetInput } from "@/lib/schemas";
import { must, run } from "./util";

function payload(b: z.output<typeof betSchema>) {
  const { legs, tags, ...rest } = b;
  return { ...rest, tags, legs: legs.length ? legs : undefined, selection: rest.selection || undefined };
}

export async function placeBet(input: BetInput) {
  return run(async () => {
    const ctx = await getContext();
    const b = betSchema.parse(input);
    const bet = must(await ctx.sb.rpc("place_bet", { p: payload(b) as never }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return { id: bet.id, ref: bet.ref };
  });
}

/** Edit any field. Financial fields are only accepted by the database while the bet is pending. */
export async function updateBet(id: string, input: BetInput) {
  return run(async () => {
    const ctx = await getContext();
    const b = betSchema.parse(input);
    const { data: cur } = await ctx.sb.from("bets").select("status, stake, odds, side, commission, bankroll_id, currency, fx_rate, kind").eq("id", id).single();
    const p: Record<string, unknown> = payload(b);
    delete p.status; delete p.client_ref; delete p.cashout_amount; delete p.settled_at;
    if (cur && cur.status !== "pending") {
      // Only send financial keys if they actually changed, so descriptive edits of settled bets work.
      const same = (k: string, v: unknown) => v == null || Number(v) === Number((cur as Record<string, unknown>)[k]) || v === (cur as Record<string, unknown>)[k];
      for (const k of ["stake", "odds", "side", "commission", "bankroll_id", "currency", "fx_rate"]) if (same(k, p[k])) delete p[k];
      delete p.legs;
    }
    if (cur?.kind !== "accumulator") delete p.legs;
    must(await ctx.sb.rpc("update_bet", { p_bet: id, p: p as never }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return id;
  });
}

export async function duplicateBet(id: string) {
  return run(async () => {
    const ctx = await getContext();
    const src = must(await ctx.sb.from("bets").select("*, bet_legs(*)").eq("id", id).single()) as Record<string, unknown> & { bet_legs: Record<string, unknown>[] };
    const keep = ["bankroll_id", "sport_id", "league_id", "event_id", "market_id", "event_name", "home", "away", "event_start", "is_live", "market_type_id",
      "market_category", "market", "selection", "line", "side", "bookmaker_id", "odds", "stake", "currency", "commission", "est_probability", "opening_odds",
      "strategy_id", "confidence", "units", "tags", "notes", "correlation_group"];
    const p: Record<string, unknown> = Object.fromEntries(keep.map((k) => [k, src[k]]));
    if (src.kind === "accumulator") p.legs = src.bet_legs.sort((a, b) => Number(a.leg_no) - Number(b.leg_no)).map((l) => ({ event_name: l.event_name, market: l.market, selection: l.selection, line: l.line, odds: l.odds }));
    if (src.currency !== ctx.bankrolls.find((b) => b.id === src.bankroll_id)?.currency) p.fx_rate = src.fx_rate;
    const bet = must(await ctx.sb.rpc("place_bet", { p: p as never }));
    return { id: bet.id, ref: bet.ref };
  });
}

export async function settleBet(input: z.input<typeof settleSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const s = settleSchema.parse(input);
    const bet = must(await ctx.sb.rpc("settle_bet", {
      p_bet: s.bet_id, p_status: s.status, p_legs: (s.legs ?? null) as never, p_closing_odds: s.closing_odds,
      p_settled_at: s.settled_at ? new Date(s.settled_at).toISOString() : undefined, p_cashout_amount: s.cashout_amount,
    }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return { profit: bet.profit };
  });
}

export async function bulkSettle(ids: string[], status: "won" | "lost" | "void" | "half_won" | "half_lost") {
  return run(async () => {
    const ctx = await getContext();
    const n = must(await ctx.sb.rpc("bulk_settle", { p_bets: z.array(z.string().uuid()).min(1).max(500).parse(ids), p_status: status }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return n;
  });
}

const bulkEditSchema = z.object({
  strategy_id: z.string().uuid().nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(), correlation_group: z.string().max(60).nullable().optional(),
  bookmaker_id: z.string().uuid().optional(), sport_id: z.string().uuid().optional(), is_live: z.boolean().optional(),
}).strict();

export async function bulkUpdate(ids: string[], patch: z.input<typeof bulkEditSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const p = bulkEditSchema.parse(patch);
    return must(await ctx.sb.rpc("bulk_update_bets", { p_bets: z.array(z.string().uuid()).min(1).max(1000).parse(ids), p: p as never }));
  });
}

export async function reopenBet(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.rpc("reopen_bet", { p_bet: id })); return id; });
}

export async function deleteBets(ids: string[]) {
  return run(async () => {
    const ctx = await getContext();
    for (const id of z.array(z.string().uuid()).min(1).max(500).parse(ids)) must(await ctx.sb.rpc("delete_bet", { p_bet: id }));
    return ids.length;
  });
}

export async function partialCashout(id: string, stakePortion: number, amount: number) {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.rpc("partial_cashout", { p_bet: id, p_stake_portion: z.number().positive().parse(stakePortion), p_amount: z.number().min(0).parse(amount) }));
    return id;
  });
}

export async function addBetNote(id: string, body: string) {
  return run(async () => {
    const ctx = await getContext();
    return must(await ctx.sb.rpc("add_bet_note", { p_bet: id, p_body: z.string().trim().min(1).max(4000).parse(body) }));
  });
}

export async function getBetDetail(id: string) {
  return run(async () => {
    const ctx = await getContext();
    const [notes, txs, audit] = await Promise.all([
      ctx.sb.from("bet_notes").select("*").eq("bet_id", id).order("created_at"),
      ctx.sb.from("bankroll_transactions").select("*").eq("bet_id", id).order("id"),
      ctx.sb.from("audit_logs").select("id, action, at, actor").eq("entity", "bets").eq("entity_id", id).order("at", { ascending: false }).limit(50),
    ]);
    return { notes: notes.data ?? [], transactions: txs.data ?? [], audit: audit.data ?? [] };
  }, false);
}

export async function importBets(bankrollId: string, rows: Record<string, unknown>[], skipDuplicates: boolean) {
  return run(async () => {
    const ctx = await getContext();
    const out = { inserted: 0, duplicates: 0, errors: [] as { row: number; message: string }[] };
    for (let i = 0; i < rows.length; i += 1000) {
      const r = must(await ctx.sb.rpc("import_bets", { p_bankroll: bankrollId, p_rows: rows.slice(i, i + 1000) as never, p_skip_duplicates: skipDuplicates })) as typeof out;
      out.inserted += r.inserted; out.duplicates += r.duplicates; out.errors.push(...r.errors);
    }
    return out;
  });
}

export async function saveView(name: string, config: Record<string, unknown>) {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.from("saved_views").upsert({ user_id: ctx.user.id, scope: "bets", name: z.string().trim().min(1).max(60).parse(name), config: config as never }, { onConflict: "user_id,scope,name" }));
    return name;
  });
}

export async function deleteView(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("saved_views").delete().eq("id", id)); return id; });
}

export async function captureClosingOdds() {
  return run(async () => { const ctx = await getContext(); return must(await ctx.sb.rpc("capture_closing_odds")); });
}
