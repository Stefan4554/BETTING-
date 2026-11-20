import { getContext } from "@/lib/server/context";
import { loadOddsBoard } from "@/lib/server/odds";
import { OddsMonitor } from "@/components/odds/monitor";

export const metadata = { title: "Odds Monitor" };

export default async function OddsPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const [board, conns] = await Promise.all([
    loadOddsBoard(ctx, { sportId: sp.sport }),
    ctx.sb.from("api_connections").select("id, provider_id, label, status, last_success_at, last_error, quota_remaining, config, is_enabled, odds_providers(name, min_refresh_seconds)"),
  ]);
  return <OddsMonitor events={board.events} snapshotCount={board.snapshotCount} isDemo={ctx.isDemo} sportFilter={sp.sport ?? ""}
    connections={(conns.data ?? []).map((c) => ({ id: c.id, provider: (c.odds_providers as { name: string } | null)?.name ?? c.provider_id, label: c.label, status: c.status,
      lastSuccess: c.last_success_at, lastError: c.last_error, quotaRemaining: c.quota_remaining, enabled: c.is_enabled,
      sports: ((c.config as { sports?: string[] }).sports ?? []), refresh: Number((c.config as { refresh_seconds?: number }).refresh_seconds ?? 600) }))} />;
}
