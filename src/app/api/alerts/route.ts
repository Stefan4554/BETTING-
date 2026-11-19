import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { AlertRuleInput } from "@/lib/validation";
import { apiError, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

async function session() {
  const sb = await supabaseServer();
  if (!sb) return { error: NextResponse.json({ error: "supabase_not_configured" }, { status: 501 }) } as const;
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { sb, userId: data.user.id } as const;
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "alerts");
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  const [rules, notes] = await Promise.all([
    s.sb.from("alert_rules").select("*").order("created_at", { ascending: false }),
    s.sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  return NextResponse.json({ rules: rules.data ?? [], notifications: notes.data ?? [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "alerts-write", 30);
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const b = AlertRuleInput.parse(await req.json());
    const { data, error } = await s.sb
      .from("alert_rules")
      .insert({ user_id: s.userId, type: b.type, threshold: b.threshold, match_ref: b.matchId, channels: b.channels, cooldown_minutes: b.cooldownMinutes, active: b.active })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ rule: data }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest) {
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const b = z.object({ id: z.string().uuid().optional(), active: z.boolean().optional(), markRead: z.array(z.number().int()).optional() }).parse(await req.json());
    if (b.id && b.active !== undefined) await s.sb.from("alert_rules").update({ active: b.active }).eq("id", b.id);
    if (b.markRead?.length) await s.sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", b.markRead);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
    await s.sb.from("alert_rules").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
