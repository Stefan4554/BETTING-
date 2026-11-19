import { NextResponse, type NextRequest } from "next/server";
import { assertCron, apiError } from "@/lib/api";
import { marketStates } from "@/lib/data/market-state";
import { evaluateAlerts, type AlertRule, type MarketState } from "@/lib/engine/alerts";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendAlertEmail } from "@/lib/email";
import { isDemoMode } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  if (isDemoMode()) return NextResponse.json({ skipped: "demo mode" });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  try {
    const next = new Map<string, MarketState>((await marketStates()).map((m) => [m.matchId, m]));
    const { data: prevRows } = await sb.from("alert_market_state").select("match_ref,state").in("match_ref", [...next.keys()]);
    const prev = new Map((prevRows ?? []).map((r) => [r.match_ref as string, r.state as MarketState]));

    const { data: ruleRows, error } = await sb.from("alert_rules").select("*, users(email)").eq("active", true);
    if (error) throw error;
    let created = 0, emailed = 0;
    for (const r of ruleRows ?? []) {
      const rule: AlertRule = {
        id: r.id, type: r.type, threshold: r.threshold == null ? null : Number(r.threshold), matchId: r.match_ref ?? null,
        active: r.active, cooldownMinutes: r.cooldown_minutes, lastTriggeredAt: r.last_triggered_at, channels: r.channels,
      };
      const events = evaluateAlerts([rule], prev, next);
      if (!events.length) continue;
      await sb.from("notifications").insert(events.map((e) => ({ user_id: r.user_id, alert_rule_id: r.id, title: e.title, body: e.body, payload: { matchId: e.matchId }, channel: "in_app" })));
      created += events.length;
      if (rule.channels.includes("email") && r.users?.email) {
        if (await sendAlertEmail(r.users.email, events)) emailed++;
      }
      await sb.from("alert_rules").update({ last_triggered_at: new Date().toISOString() }).eq("id", r.id);
    }
    await sb.from("alert_market_state").upsert([...next.values()].map((s) => ({ match_ref: s.matchId, state: s, updated_at: new Date().toISOString() })));
    return NextResponse.json({ rules: ruleRows?.length ?? 0, notifications: created, emailed });
  } catch (e) {
    return apiError(e);
  }
}
