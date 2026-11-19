import { getBetStorage } from "@/lib/data/bets";
import { PageHeader } from "@/components/terminal/primitives";
import { BankrollView } from "./view";

export const metadata = { title: "Bankroll management" };

export default async function BankrollPage() {
  const { storage, bets } = await getBetStorage();
  return (
    <>
      <PageHeader title="Bankroll management" description="Bankroll history from settled bets, drawdown, exposure on pending bets and a fractional-Kelly stake calculator." />
      <BankrollView storage={storage} initial={bets} />
    </>
  );
}
