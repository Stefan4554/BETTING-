"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { evaluateRiskAlerts } from "@/lib/server/alerts";
import { bankrollSchema, executionSchema, riskSchema, strategySchema, tradeSchema, transferSchema, txSchema } from "@/lib/schemas";
import { must, run } from "./util";

export async function createBankroll(input: z.input<typeof bankrollSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const b = bankrollSchema.parse(input);
    return must(await ctx.sb.rpc("create_bankroll", {
      p_name: b.name, p_currency: b.currency, p_kind: b.kind, p_sport: b.sport_id, p_opening_deposit: b.opening_deposit ?? 0, p_allow_negative: b.allow_negative,
    }));
  });
}

export async function updateBankroll(id: string, patch: { name?: string; archived?: boolean; allow_negative?: boolean }) {
  return run(async () => {
    const ctx = await getContext();
    const p = z.object({ name: z.string().trim().min(1).max(60).optional(), archived: z.boolean().optional(), allow_negative: z.boolean().optional() }).strict().parse(patch);
    must(await ctx.sb.from("bankrolls").update(p).eq("id", id));
    return id;
  });
}

export async function recordTransaction(input: z.input<typeof txSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const t = txSchema.parse(input);
    const r = must(await ctx.sb.rpc("record_transaction", {
      p_bankroll: t.bankroll_id, p_type: t.type, p_amount: t.amount, p_note: t.note || undefined,
      p_occurred_at: t.occurred_at ? new Date(t.occurred_at).toISOString() : undefined,
    }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return r.id;
  });
}

export async function transferFunds(input: z.input<typeof transferSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const t = transferSchema.parse(input);
    return must(await ctx.sb.rpc("transfer_funds", { p_from: t.from, p_to: t.to, p_amount: t.amount, p_fx_rate: t.fx_rate, p_note: t.note || undefined }));
  });
}

export async function verifyBankroll(id: string) {
  return run(async () => { const ctx = await getContext(); return must(await ctx.sb.rpc("verify_bankroll", { p_bankroll: id })) as { cached: number; ledger: number; consistent: boolean }; }, false);
}

export async function refreshSnapshots() {
  return run(async () => { const ctx = await getContext(); return must(await ctx.sb.rpc("refresh_performance_snapshots")); });
}

export async function saveStrategy(input: z.input<typeof strategySchema>) {
  return run(async () => {
    const ctx = await getContext();
    const s = strategySchema.parse(input);
    const row = {
      name: s.name, description: s.description ?? null, sport_id: s.sport_id ?? null, market_type_id: s.market_type_id ?? null,
      entry_conditions: s.entry_conditions ?? null, min_odds: s.min_odds ?? null, max_odds: s.max_odds ?? null, est_probability: s.est_probability ?? null,
      stake_rule: { type: s.stake_type, value: s.stake_value ?? 1 }, color: s.color, is_active: s.is_active,
    };
    if (s.id) must(await ctx.sb.from("strategies").update(row).eq("id", s.id));
    else must(await ctx.sb.from("strategies").insert({ ...row, user_id: ctx.user.id, is_demo: ctx.isDemo }));
    return s.name;
  });
}

export async function deleteStrategy(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("strategies").delete().eq("id", id)); return id; });
}

export async function saveRiskLimits(input: z.input<typeof riskSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const r = riskSchema.parse(input);
    const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? null]));
    must(await ctx.sb.from("risk_limits").update(row as never).eq("user_id", ctx.user.id).eq("is_demo", ctx.isDemo));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return true;
  });
}

export async function saveGoal(input: { name: string; metric: string; target: number; period_start: string; period_end: string; bankroll_id?: string | null }) {
  return run(async () => {
    const ctx = await getContext();
    const g = z.object({
      name: z.string().trim().min(1).max(80), metric: z.enum(["profit", "roi", "bankroll", "clv", "bets", "win_rate"]), target: z.number().finite(),
      period_start: z.string().date(), period_end: z.string().date(), bankroll_id: z.string().uuid().nullish(),
    }).parse(input);
    must(await ctx.sb.from("goals").insert({ ...g, bankroll_id: g.bankroll_id ?? null, user_id: ctx.user.id, is_demo: ctx.isDemo }));
    return true;
  });
}

export async function deleteGoal(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("goals").delete().eq("id", id)); return id; });
}

// ── Trading ────────────────────────────────────────────────────────────────
export async function openTrade(input: z.input<typeof tradeSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const t = tradeSchema.parse(input);
    const { side, odds, stake, ...rest } = t;
    return must(await ctx.sb.rpc("open_trade", { p: { ...rest, executions: [{ side, odds, stake }] } as never })).id;
  });
}

export async function addExecution(input: z.input<typeof executionSchema>) {
  return run(async () => {
    const ctx = await getContext();
    const e = executionSchema.parse(input);
    return must(await ctx.sb.rpc("add_trade_execution", {
      p_trade: e.trade_id, p_side: e.side, p_odds: e.side === "cashout" ? undefined : e.odds, p_stake: e.stake, p_amount: e.amount, p_note: e.note,
    } as never)).id;
  });
}

export async function settleTrade(id: string, outcome: "win" | "lose" | "void") {
  return run(async () => {
    const ctx = await getContext();
    const t = must(await ctx.sb.rpc("settle_trade", { p_trade: id, p_outcome: z.enum(["win", "lose", "void"]).parse(outcome) }));
    await evaluateRiskAlerts(ctx).catch(() => 0);
    return t.realized_pnl;
  });
}
