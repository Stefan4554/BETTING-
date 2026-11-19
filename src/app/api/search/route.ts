import { NextResponse, type NextRequest } from "next/server";
import { getPlayers, getSnapshot, getTournaments } from "@/lib/data/service";
import { rateLimit } from "@/lib/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "search", 120);
  if (limited) return limited;
  const q = z.string().trim().min(2).max(60).safeParse(req.nextUrl.searchParams.get("q"));
  if (!q.success) return NextResponse.json({ hits: [] });
  const needle = q.data.toLowerCase();
  const [snap, players, tournaments] = await Promise.all([getSnapshot(), getPlayers(), getTournaments()]);
  const hits = [
    ...players.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 5).map((p) => ({ type: "player", id: p.id, label: p.name, sub: p.rank ? `#${p.rank}` : "player", href: `/players/${encodeURIComponent(p.id)}` })),
    ...snap.matches.filter((m) => `${m.playerA.name} ${m.playerB.name}`.toLowerCase().includes(needle)).slice(0, 5).map((m) => ({ type: "match", id: m.id, label: `${m.playerA.name} v ${m.playerB.name}`, sub: m.status, href: `/matches/${encodeURIComponent(m.id)}` })),
    ...tournaments.filter((t) => t.name.toLowerCase().includes(needle)).slice(0, 3).map((t) => ({ type: "tournament", id: t.id, label: t.name, sub: "tournament", href: `/tournaments?t=${encodeURIComponent(t.id)}` })),
  ];
  return NextResponse.json({ hits });
}
