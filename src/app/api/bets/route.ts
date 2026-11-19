import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { BetInput, BetPatch } from "@/lib/validation";
import { apiError, rateLimit } from "@/lib/api";
import { rowToBet } from "@/lib/data/bets";

export const dynamic = "force-dynamic";

async function session() {
  const sb = await supabaseServer();
  if (!sb) return { error: NextResponse.json({ error: "supabase_not_configured" }, { status: 501 }) } as const;
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { sb, userId: data.user.id } as const;
}

const toRow = (b: Partial<BetInput>) => ({
  ...(b.eventLabel !== undefined && { event_label: b.eventLabel }),
  ...(b.sport !== undefined && { sport: b.sport }),
  ...(b.market !== undefined && { market: b.market }),
  ...(b.selection !== undefined && { selection: b.selection }),
  ...(b.bookmaker !== undefined && { bookmaker_label: b.bookmaker }),
  ...(b.odds !== undefined && { odds: b.odds }),
  ...(b.stake !== undefined && { stake: b.stake }),
  ...(b.closingOdds !== undefined && { closing_odds: b.closingOdds }),
  ...(b.status !== undefined && { status: b.status }),
  ...(b.placedAt !== undefined && { placed_at: b.placedAt }),
  ...(b.notes !== undefined && { notes: b.notes }),
});

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "bets");
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  const { data, error } = await s.sb.from("bets").select("*").order("placed_at", { ascending: false }).limit(5000);
  if (error) return apiError(error);
  return NextResponse.json({ bets: (data ?? []).map(rowToBet) });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "bets-write", 30);
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const body = BetInput.parse(await req.json());
    const { data, error } = await s.sb.from("bets").insert({ ...toRow(body), user_id: s.userId }).select("*").single();
    if (error) throw error;
    // Bankroll ledger entry for the stake (profit is booked on settlement).
    await s.sb.from("bankroll_transactions").insert({ user_id: s.userId, bet_id: data.id, type: "bet_stake", amount: -body.stake });
    return NextResponse.json({ bet: rowToBet(data) }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(req, "bets-write", 30);
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const { id, ...patch } = BetPatch.parse(await req.json());
    const { data, error } = await s.sb.from("bets").update(toRow(patch)).eq("id", id).select("*").single();
    if (error) throw error;
    if (patch.status && patch.status !== "pending" && data.profit != null) {
      await s.sb.from("bankroll_transactions").delete().eq("bet_id", id).eq("type", "bet_return");
      const ret = Number(data.stake) + Number(data.profit);
      if (ret !== 0) await s.sb.from("bankroll_transactions").insert({ user_id: s.userId, bet_id: id, type: "bet_return", amount: ret });
    }
    return NextResponse.json({ bet: rowToBet(data) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(req, "bets-write", 30);
  if (limited) return limited;
  const s = await session();
  if ("error" in s) return s.error;
  try {
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
    const { error } = await s.sb.from("bets").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
