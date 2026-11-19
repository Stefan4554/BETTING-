import { NextResponse, type NextRequest } from "next/server";
import { getMarketRows, getOddsHistory } from "@/lib/data/service";
import { apiError, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const limited = rateLimit(req, "odds");
  if (limited) return limited;
  try {
    const { matchId } = await ctx.params;
    const id = decodeURIComponent(matchId);
    const [markets, history] = await Promise.all([getMarketRows(id), getOddsHistory(id)]);
    return NextResponse.json({ matchId: id, markets, history: history.points, note: history.note });
  } catch (e) {
    return apiError(e);
  }
}
