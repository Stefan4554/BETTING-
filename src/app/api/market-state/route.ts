import { NextResponse, type NextRequest } from "next/server";
import { marketStates } from "@/lib/data/market-state";
import { apiError, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "market-state", 60);
  if (limited) return limited;
  try {
    return NextResponse.json({ at: new Date().toISOString(), states: await marketStates() });
  } catch (e) {
    return apiError(e);
  }
}
