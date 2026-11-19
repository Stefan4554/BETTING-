import { NextResponse, type NextRequest } from "next/server";
import { getBetStorage } from "@/lib/data/bets";
import { betsToCsv } from "@/lib/engine/bets";
import { rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "bets-export", 10);
  if (limited) return limited;
  const { storage, bets, signedIn } = await getBetStorage();
  if (storage === "supabase" && !signedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (storage === "local") return NextResponse.json({ error: "bets are stored in the browser; export from the tracker page" }, { status: 400 });
  return new NextResponse(betsToCsv(bets), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="edge-bets-${storage}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
