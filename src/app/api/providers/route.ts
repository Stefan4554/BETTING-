import { NextResponse, type NextRequest } from "next/server";
import { providerInfos } from "@/lib/providers/registry";
import { rateLimit } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Provider status (never returns keys). Admin-only when auth is enabled. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "providers", 30);
  if (limited) return limited;
  if (isSupabaseConfigured()) {
    const u = await currentUser();
    if (u?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ providers: providerInfos() });
}
