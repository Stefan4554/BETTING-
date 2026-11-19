import { getBetStorage } from "@/lib/data/bets";
import { PageHeader } from "@/components/terminal/primitives";
import { PerformanceView } from "./view";

export const metadata = { title: "Performance analytics" };

export default async function PerformancePage() {
  const { storage, bets } = await getBetStorage();
  return (
    <>
      <PageHeader title="Performance analytics" description="Profit, ROI, yield, win rate and CLV by period, sport, market and bookmaker. CLV is the best long-run indicator of skill; short-run profit is mostly variance." />
      <PerformanceView storage={storage} initial={bets} />
    </>
  );
}
