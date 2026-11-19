import { liveViews, livePollMs } from "@/lib/data/live";
import { getSnapshot, mode } from "@/lib/data/service";
import { LiveCentre } from "@/components/terminal/live-centre";
import { Notices, PageHeader } from "@/components/terminal/primitives";

export const metadata = { title: "Live matches" };

export default async function LivePage() {
  const [snap, matches] = await Promise.all([getSnapshot(), liveViews()]);
  return (
    <>
      <PageHeader title="Live match centre" description="Live scores, serve, statistics, live odds and model-based live win probability. Suspended, delayed and interrupted matches are flagged." />
      <Notices notices={snap.notices} />
      <LiveCentre initial={{ mode: mode(), pollMs: livePollMs(), at: new Date().toISOString(), matches }} />
    </>
  );
}
