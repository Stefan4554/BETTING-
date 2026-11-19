import { getSnapshot, getValueCandidates } from "@/lib/data/service";
import { Notices, PageHeader } from "@/components/terminal/primitives";
import { ValueBoard } from "./value-board";

export const metadata = { title: "Value bets" };

export default async function ValuePage() {
  const [snap, initial] = await Promise.all([getSnapshot(), getValueCandidates()]);
  return (
    <>
      <PageHeader title="Value betting engine" description="Model probability vs best available price. EV = p × odds − 1 · Fair odds = 1/p · Market probability = no-vig consensus · Stake = fractional Kelly with confidence shrinkage and cap." />
      <Notices notices={snap.notices} />
      <div className="rounded-[3px] border border-warn/30 bg-warn-soft px-3 py-1.5 text-xs text-warn">
        A positive EV is a model estimate, not a guarantee. Model error, missing information (injuries, withdrawals, conditions) and line moves can turn an apparent edge negative. Large disagreements with the market are marked SUSPECT and excluded by default.
      </div>
      <ValueBoard initial={initial} />
    </>
  );
}
