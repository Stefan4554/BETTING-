import { getBetStorage } from "@/lib/data/bets";
import { PageHeader } from "@/components/terminal/primitives";
import { Tracker } from "./tracker";

export const metadata = { title: "Betting tracker" };

export default async function TrackerPage() {
  const { storage, bets, signedIn } = await getBetStorage();
  return (
    <>
      <PageHeader title="Betting tracker" description="Record bets manually. Profit/loss is calculated automatically on settlement (won, lost, void, half-won, half-lost, cash-out)." />
      <Tracker storage={storage} initial={bets} signedIn={signedIn} />
    </>
  );
}
