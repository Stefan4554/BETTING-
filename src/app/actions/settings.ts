"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getContext, RANGE_COOKIE, type RangeSetting } from "@/lib/server/context";
import { buildDemoDataset } from "@/lib/demo/generator";
import { must, run } from "./util";

export async function setRange(r: RangeSetting) {
  return run(async () => {
    const v = z.object({ preset: z.enum(["today", "yesterday", "7d", "30d", "90d", "ytd", "all", "custom"]), from: z.string().date().nullish(), to: z.string().date().nullish() }).parse(r);
    (await cookies()).set(RANGE_COOKIE, JSON.stringify(v), { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, httpOnly: true });
    return v;
  });
}

const settingsSchema = z.object({
  display_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  odds_format: z.enum(["decimal", "american", "fractional"]).optional(),
  theme: z.enum(["dark", "darker", "light"]).optional(),
  timezone: z.string().max(60).optional(),
  clv_convention: z.enum(["odds", "probability"]).optional(),
  clv_reference_bookmaker: z.string().uuid().nullable().optional(),
  default_kelly_fraction: z.number().gt(0).max(1).optional(),
  unit_size: z.number().positive().optional(),
  default_bankroll_id: z.string().uuid().nullable().optional(),
  dashboard_widgets: z.array(z.string().max(40)).max(40).optional(),
  alert_preferences: z.object({ large_result: z.number().min(0), odds_move_pct: z.number().min(0).max(1), email: z.boolean() }).optional(),
}).strict();

export async function updateSettings(patch: z.input<typeof settingsSchema>) {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.from("user_settings").update(settingsSchema.parse(patch)).eq("user_id", ctx.user.id));
    return true;
  });
}

export async function updateProfile(patch: { display_name?: string; base_currency?: string }) {
  return run(async () => {
    const ctx = await getContext();
    const p = z.object({ display_name: z.string().trim().max(80).optional(), base_currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict().parse(patch);
    must(await ctx.sb.from("profiles").update(p).eq("id", ctx.user.id));
    return true;
  });
}

export async function setMode(mode: "live" | "demo") {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.rpc("set_workspace_mode", { p_mode: z.enum(["live", "demo"]).parse(mode) }));
    if (mode === "demo") {
      const { count } = await ctx.sb.from("bankrolls").select("id", { count: "exact", head: true }).eq("is_demo", true);
      if (!count) must(await ctx.sb.rpc("reset_demo_data", { p: buildDemoDataset() as never }));
    }
    return mode;
  });
}

/** One-click reset: replaces every demo row with a fresh simulated dataset. Live data is untouched. */
export async function resetDemo() {
  return run(async () => {
    const ctx = await getContext();
    return must(await ctx.sb.rpc("reset_demo_data", { p: buildDemoDataset() as never }));
  });
}

export async function clearDemo() {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.rpc("clear_demo_data"));
    must(await ctx.sb.rpc("set_workspace_mode", { p_mode: "live" }));
    return true;
  });
}

export async function markAlertsRead(ids?: string[]) {
  return run(async () => {
    const ctx = await getContext();
    let q = ctx.sb.from("alerts").update({ read_at: new Date().toISOString() }).is("read_at", null).eq("is_demo", ctx.isDemo);
    if (ids?.length) q = q.in("id", ids);
    must(await q);
    return true;
  });
}

export async function deleteAlert(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("alerts").delete().eq("id", id)); return id; });
}

export async function addExchangeRate(input: { base: string; quote: string; rate: number; as_of: string }) {
  return run(async () => {
    const ctx = await getContext();
    const r = z.object({ base: z.string().regex(/^[A-Z]{3}$/), quote: z.string().regex(/^[A-Z]{3}$/), rate: z.number().positive(), as_of: z.string().date() })
      .refine((x) => x.base !== x.quote, "Choose two different currencies").parse(input);
    must(await ctx.sb.from("exchange_rates").upsert({ ...r, owner_id: ctx.user.id, source: "manual" }, { onConflict: "owner_id,base,quote,as_of" }));
    return true;
  });
}

export async function deleteExchangeRate(id: number) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("exchange_rates").delete().eq("id", id)); return id; });
}

// ── Catalogue (user-defined sports, leagues, markets, bookmakers) ───────────
const key = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "custom";

export async function addSport(name: string, hasDraw: boolean) {
  return run(async () => {
    const ctx = await getContext();
    const n = z.string().trim().min(1).max(60).parse(name);
    must(await ctx.sb.from("sports").insert({ owner_id: ctx.user.id, key: key(n), name: n, has_draw: hasDraw, sort_order: 200 }));
    return n;
  });
}

export async function addLeague(sportId: string, name: string, country?: string) {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.from("leagues").insert({ owner_id: ctx.user.id, sport_id: z.string().uuid().parse(sportId), name: z.string().trim().min(1).max(120).parse(name), country: country || null }));
    return name;
  });
}

export async function addMarketType(input: { name: string; category: string; sport_id?: string | null; has_line: boolean; settlement: string; outcomes: string[] }) {
  return run(async () => {
    const ctx = await getContext();
    const m = z.object({
      name: z.string().trim().min(1).max(80), category: z.enum(["result", "handicap", "totals", "props", "specials", "other"]),
      sport_id: z.string().uuid().nullish(), has_line: z.boolean(), settlement: z.enum(["binary", "quarter", "multi"]), outcomes: z.array(z.string().trim().min(1).max(40)).max(40),
    }).parse(input);
    must(await ctx.sb.from("market_types").insert({ ...m, sport_id: m.sport_id ?? null, owner_id: ctx.user.id, key: key(m.name) }));
    return m.name;
  });
}

export async function deleteCatalogItem(table: "sports" | "leagues" | "market_types" | "bookmakers", id: string) {
  return run(async () => {
    const ctx = await getContext();
    must(await ctx.sb.from(z.enum(["sports", "leagues", "market_types", "bookmakers"]).parse(table)).delete().eq("id", id).eq("owner_id", ctx.user.id));
    return id;
  });
}

export async function saveBookmaker(input: { id?: string; name: string; is_exchange: boolean; default_commission: number; website?: string }) {
  return run(async () => {
    const ctx = await getContext();
    const b = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), is_exchange: z.boolean(), default_commission: z.number().min(0).lt(1), website: z.string().url().max(200).optional().or(z.literal("")) }).parse(input);
    const row = { name: b.name, is_exchange: b.is_exchange, default_commission: b.default_commission, website: b.website || null };
    if (b.id) must(await ctx.sb.from("bookmakers").update(row).eq("id", b.id).eq("owner_id", ctx.user.id));
    else must(await ctx.sb.from("bookmakers").insert({ ...row, owner_id: ctx.user.id, key: key(b.name) }));
    return b.name;
  });
}

export async function saveBookmakerAccount(input: { bookmaker_id: string; currency: string; commission?: number | null; max_stake?: number | null; status: string; notes?: string }) {
  return run(async () => {
    const ctx = await getContext();
    const a = z.object({
      bookmaker_id: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/), commission: z.number().min(0).lt(1).nullish(), max_stake: z.number().positive().nullish(),
      status: z.enum(["active", "limited", "restricted", "closed"]), notes: z.string().max(2000).optional(),
    }).parse(input);
    must(await ctx.sb.from("bookmaker_accounts").upsert({ ...a, commission: a.commission ?? null, max_stake: a.max_stake ?? null, user_id: ctx.user.id }, { onConflict: "user_id,bookmaker_id" }));
    return true;
  });
}
