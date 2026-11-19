import { NextResponse, type NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data/service";
import { apiError, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "matches");
  if (limited) return limited;
  try {
    const s = await getSnapshot();
    return NextResponse.json({ mode: s.mode, generatedAt: s.generatedAt, notices: s.notices, matches: s.matches });
  } catch (e) {
    return apiError(e);
  }
}
