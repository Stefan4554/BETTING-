import { matchRows } from "@/lib/data/views";
import { getSnapshot } from "@/lib/data/service";
import { MatchTable } from "@/components/terminal/match-table";
import { Notices, PageHeader, Panel } from "@/components/terminal/primitives";

export const metadata = { title: "Upcoming matches" };

export default async function UpcomingPage() {
  const [snap, rows] = await Promise.all([getSnapshot(), matchRows((m) => m.status === "scheduled" || m.status === "delayed" || m.status === "postponed")]);
  return (
    <>
      <PageHeader title="Upcoming matches" description="Scheduled matches with best match-winner prices and model probabilities." />
      <Notices notices={snap.notices} />
      <Panel title="Schedule" subtitle={`${rows.length} matches`}>
        <MatchTable rows={rows} showScore={false} emptyTitle="No upcoming matches match these filters" />
      </Panel>
    </>
  );
}
