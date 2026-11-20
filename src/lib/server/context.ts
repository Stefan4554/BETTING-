import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer, type DB } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { resolveRange, type RangePreset } from "@/lib/finance/metrics";

export type Settings = Tables<"user_settings">;
export type Bankroll = Tables<"bankrolls">;
export type Sport = Tables<"sports">;
export type Bookmaker = Tables<"bookmakers">;
export type Strategy = Tables<"strategies">;
export type MarketType = Tables<"market_types">;
export type League = Tables<"leagues">;

export interface AppContext {
  sb: DB;
  user: { id: string; email: string | null };
  profile: Tables<"profiles"> | null;
  settings: Settings;
  isDemo: boolean;
  displayCurrency: string;
  bankrolls: Bankroll[];
  sports: Sport[];
  bookmakers: Bookmaker[];
  strategies: Strategy[];
  marketTypes: MarketType[];
  leagues: League[];
  unreadAlerts: number;
}

/** Everything a page needs about the signed-in user, loaded once per request. */
export const getContext = cache(async (): Promise<AppContext> => {
  const sb = await supabaseServer();
  if (!sb) redirect("/setup");
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");
  const uid = auth.user.id;
  const [profile, settings] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
  ]);
  if (!settings.data) throw new Error("User settings missing — was the signup trigger installed? Run the migrations.");
  const isDemo = settings.data.mode === "demo";
  const [bankrolls, sports, bookmakers, strategies, marketTypes, leagues, alerts] = await Promise.all([
    sb.from("bankrolls").select("*").eq("is_demo", isDemo).order("created_at"),
    sb.from("sports").select("*").eq("is_active", true).order("sort_order"),
    sb.from("bookmakers").select("*").order("name"),
    sb.from("strategies").select("*").eq("is_demo", isDemo).order("name"),
    sb.from("market_types").select("*").eq("is_active", true).order("name"),
    sb.from("leagues").select("*").order("name"),
    sb.from("alerts").select("id", { count: "exact", head: true }).eq("is_demo", isDemo).is("read_at", null),
  ]);
  return {
    sb, user: { id: uid, email: auth.user.email ?? null }, profile: profile.data, settings: settings.data, isDemo,
    displayCurrency: settings.data.display_currency,
    bankrolls: bankrolls.data ?? [], sports: sports.data ?? [], bookmakers: bookmakers.data ?? [],
    strategies: strategies.data ?? [], marketTypes: marketTypes.data ?? [], leagues: leagues.data ?? [],
    unreadAlerts: alerts.count ?? 0,
  };
});

export interface RangeSetting { preset: RangePreset; from?: string | null; to?: string | null }
export const RANGE_COOKIE = "bep_range";

export async function getRange(): Promise<RangeSetting & { label: string }> {
  const raw = (await cookies()).get(RANGE_COOKIE)?.value;
  let r: RangeSetting = { preset: "all" };
  try { if (raw) r = JSON.parse(raw) as RangeSetting; } catch { /* ignore */ }
  const labels: Record<RangePreset, string> = {
    today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
    ytd: "Year to date", all: "All time", custom: `${r.from ?? "…"} → ${r.to ?? "…"}`,
  };
  return { ...r, label: labels[r.preset] ?? "All time" };
}

export async function getResolvedRange() {
  const r = await getRange();
  return { setting: r, range: resolveRange(r.preset, new Date(), r) };
}
