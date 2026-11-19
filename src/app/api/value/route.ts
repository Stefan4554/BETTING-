import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getValueCandidates } from "@/lib/data/service";
import { DEFAULT_VALUE_SETTINGS } from "@/lib/engine/value";
import { apiError, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

const Settings = z.object({
  fraction: z.coerce.number().gt(0).max(1).default(DEFAULT_VALUE_SETTINGS.fraction),
  maxStakePct: z.coerce.number().gt(0).max(1).default(DEFAULT_VALUE_SETTINGS.maxStakePct),
  modelConfidence: z.coerce.number().min(0).max(1).default(DEFAULT_VALUE_SETTINGS.modelConfidence!),
  minEdge: z.coerce.number().min(-1).max(1).default(DEFAULT_VALUE_SETTINGS.minEdge),
  minDataQuality: z.coerce.number().min(0).max(1).default(DEFAULT_VALUE_SETTINGS.minDataQuality),
  maxDivergence: z.coerce.number().gt(0).max(1).default(DEFAULT_VALUE_SETTINGS.maxDivergence),
});

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "value");
  if (limited) return limited;
  try {
    const settings = Settings.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json({ settings, opportunities: await getValueCandidates(settings) });
  } catch (e) {
    return apiError(e);
  }
}
