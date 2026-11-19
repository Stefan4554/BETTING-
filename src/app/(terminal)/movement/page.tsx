import { getOddsHistory, getSnapshot } from "@/lib/data/service";
import { FINISHED_STATUSES } from "@/lib/domain";
import { Notices, PageHeader } from "@/components/terminal/primitives";
import { MovementExplorer } from "./explorer";

export const metadata = { title: "Odds movement" };

export default async function MovementPage({ searchParams }: { searchParams: Promise<{ match?: string }> }) {
  const { match } = await searchParams;
  const snap = await getSnapshot();
  const candidates = snap.matches.filter((m) => (snap.quotes[m.id] ?? []).length || FINISHED_STATUSES.includes(m.status));
  const selected = candidates.find((m) => m.id === match) ?? candidates.find((m) => (snap.quotes[m.id] ?? []).length) ?? null;
  const history = selected ? await getOddsHistory(selected.id) : { points: [], note: null };
  return (
    <>
      <PageHeader title="Odds movement & line history" description="Opening vs current, per-bookmaker history, best-price history, no-vig consensus, steam moves and shortening/drifting. Snapshots are stored in odds_snapshots." />
      <Notices notices={snap.notices} />
      <MovementExplorer
        matches={candidates.map((m) => ({ id: m.id, label: `${m.playerA.name} v ${m.playerB.name}`, a: m.playerA.name, b: m.playerB.name, start: m.scheduledAt, status: m.status }))}
        selectedId={selected?.id ?? null}
        history={history.points}
        note={history.note}
      />
    </>
  );
}
