import { getContext } from "@/lib/server/context";
import { loadRiskLimits } from "@/lib/server/data";
import { StakingCalculator } from "@/components/tools/staking";

export const metadata = { title: "Staking Calculator" };

export default async function StakingPage() {
  const ctx = await getContext();
  const limits = await loadRiskLimits(ctx);
  const main = ctx.bankrolls.find((b) => b.id === ctx.settings.default_bankroll_id) ?? ctx.bankrolls[0];
  return <StakingCalculator defaults={{
    bankroll: main ? Number(main.balance) : 1000, currency: main?.currency ?? ctx.displayCurrency, kellyFraction: Number(ctx.settings.default_kelly_fraction),
    unitSize: Number(ctx.settings.unit_size), maxStake: limits?.max_stake_per_bet == null ? null : Number(limits.max_stake_per_bet),
    maxPct: limits?.max_bet_pct_bankroll == null ? null : Number(limits.max_bet_pct_bankroll),
  }} />;
}
