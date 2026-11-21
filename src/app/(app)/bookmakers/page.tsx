import { getContext, getResolvedRange } from "@/lib/server/context";
import { buildAnalytics, loadAnalyticsBase } from "@/lib/server/analytics";
import { BookmakersView } from "@/components/tools/bookmakers";

export const metadata = { title: "Bookmakers" };

export default async function BookmakersPage() {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const [base, accounts] = await Promise.all([loadAnalyticsBase(ctx), ctx.sb.from("bookmaker_accounts").select("*")]);
  const a = buildAnalytics(ctx, base, range);
  const exposure = Object.fromEntries(a.risk.byBookmaker.map((r) => [r.key, r.exposure]));
  return <BookmakersView rangeLabel={setting.label} currency={ctx.displayCurrency} convention={a.convention} groups={a.byBookmaker} exposure={exposure}
    bookmakers={ctx.bookmakers.map((b) => ({ id: b.id, name: b.name, key: b.key, is_exchange: b.is_exchange, default_commission: Number(b.default_commission), website: b.website, owner_id: b.owner_id }))}
    accounts={(accounts.data ?? []).map((x) => ({ bookmaker_id: x.bookmaker_id, currency: x.currency, commission: x.commission == null ? null : Number(x.commission), max_stake: x.max_stake == null ? null : Number(x.max_stake), status: x.status, notes: x.notes }))} />;
}
