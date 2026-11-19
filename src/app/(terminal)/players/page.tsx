import { getModel, getPlayers, getSnapshot } from "@/lib/data/service";
import { playerAnalytics } from "@/lib/engine/player-analytics";
import { Notices, PageHeader, Panel, EmptyState } from "@/components/terminal/primitives";
import { PlayersTable, type PlayerRow } from "./players-table";

export const metadata = { title: "Player database" };

export default async function PlayersPage() {
  const [snap, players, model] = await Promise.all([getSnapshot(), getPlayers(), getModel()]);
  const rows: PlayerRow[] = players.map((p) => {
    const a = model.history.length ? playerAnalytics(p.id, model.history) : null;
    const rating = model.model?.ratings.get(p.id);
    return {
      ...p,
      elo: rating ? Math.round(rating.overall) : null,
      matches: a?.matches ?? null,
      winPct: a?.overall.pct ?? null,
      last10: a ? `${a.last10.wins}-${a.last10.losses}` : null,
      holdPct: a?.holdPct ?? null,
      breakPct: a?.breakPct ?? null,
    };
  });
  return (
    <>
      <PageHeader title="Player database" description="Rankings and profile data from the tennis data provider; ratings and form from stored match history." />
      <Notices notices={snap.notices.filter((n) => n.text.includes("tennis") || n.text.includes("DEMO"))} />
      <Panel title="Players" subtitle={`${rows.length}`}>
        {rows.length ? <PlayersTable rows={rows} /> : <EmptyState title="No player data">Rankings come from Sportradar (SPORTRADAR_TENNIS_API_KEY).</EmptyState>}
      </Panel>
    </>
  );
}
