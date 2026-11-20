"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { run } from "./util";

/** Global search across bets, strategies and trades of the active workspace. */
export async function searchAll(q: string) {
  return run(async () => {
    const ctx = await getContext();
    const term = z.string().trim().min(1).max(80).parse(q).replace(/[%_,()]/g, " ");
    const like = `%${term}%`;
    const asRef = /^#?\d+$/.test(term) ? Number(term.replace("#", "")) : null;
    const [bets, strategies, trades] = await Promise.all([
      ctx.sb.from("bets").select("id, ref, event_name, selection, market, status, placed_at").eq("is_demo", ctx.isDemo).is("deleted_at", null)
        .or(asRef != null ? `ref.eq.${asRef}` : `event_name.ilike.${like},selection.ilike.${like},market.ilike.${like},notes.ilike.${like}`)
        .order("placed_at", { ascending: false }).limit(12),
      ctx.sb.from("strategies").select("id, name").eq("is_demo", ctx.isDemo).ilike("name", like).limit(5),
      ctx.sb.from("trades").select("id, event_name, selection, status").eq("is_demo", ctx.isDemo).ilike("event_name", like).limit(5),
    ]);
    return { bets: bets.data ?? [], strategies: strategies.data ?? [], trades: trades.data ?? [] };
  }, false);
}

export async function recentAlerts() {
  return run(async () => {
    const ctx = await getContext();
    const { data } = await ctx.sb.from("alerts").select("*").eq("is_demo", ctx.isDemo).order("created_at", { ascending: false }).limit(15);
    return data ?? [];
  }, false);
}

export async function marketHistory(marketId: string) {
  return run(async () => {
    const { loadMarketHistory } = await import("@/lib/server/odds");
    return loadMarketHistory(await getContext(), z.string().uuid().parse(marketId));
  }, false);
}
