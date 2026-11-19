import { getOddsHistory, getSnapshot } from "@/lib/data/service";
import { buildComparisonRows } from "@/lib/data/board";
import { FINISHED_STATUSES } from "@/lib/domain";
import { Notices, PageHeader } from "@/components/terminal/primitives";
import { ComparisonTable } from "./comparison-table";

export const metadata = { title: "Odds comparison" };

export default async function OddsPage({ searchParams }: { searchParams: Promise<{ match?: string }> }) {
  const { match } = await searchParams;
  const snap = await getSnapshot();
  const open = snap.matches.filter((m) => !FINISHED_STATUSES.includes(m.status) && (snap.quotes[m.id] ?? []).length);
  const rows = (await Promise.all(open.map(async (m) => buildComparisonRows(m, snap.quotes[m.id]!, (await getOddsHistory(m.id)).points)))).flat();
  return (
    <>
      <PageHeader title="Bookmaker odds comparison" description="Every bookmaker price with opening price, best available, last update and movement. Sort any column; filter by bookmaker, market and match." />
      <Notices notices={snap.notices} />
      <ComparisonTable rows={rows} initialMatch={match ?? ""} />
    </>
  );
}
