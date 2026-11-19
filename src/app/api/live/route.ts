import { NextResponse, type NextRequest } from "next/server";
import { liveViews, livePollMs } from "@/lib/data/live";
import { apiError, rateLimit } from "@/lib/api";
import { mode } from "@/lib/data/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "live", 120);
  if (limited) return limited;
  try {
    return NextResponse.json({ mode: mode(), pollMs: livePollMs(), at: new Date().toISOString(), matches: await liveViews() });
  } catch (e) {
    return apiError(e);
  }
}
