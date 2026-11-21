import { getContext, getRange } from "@/lib/server/context";
import { AppDataProvider, type AppData } from "@/components/app/app-data";
import { Shell } from "@/components/app/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const range = await getRange();
  const value: AppData = {
    userEmail: ctx.user.email,
    isDemo: ctx.isDemo,
    displayCurrency: ctx.displayCurrency,
    oddsFormat: ctx.settings.odds_format as AppData["oddsFormat"],
    unitSize: Number(ctx.settings.unit_size),
    kellyFraction: Number(ctx.settings.default_kelly_fraction),
    defaultBankrollId: ctx.settings.default_bankroll_id,
    bankrolls: ctx.bankrolls.map((b) => ({ id: b.id, name: b.name, currency: b.currency, balance: Number(b.balance), archived: b.archived, kind: b.kind })),
    sports: ctx.sports.map((s) => ({ id: s.id, name: s.name, key: s.key, has_draw: s.has_draw, owner_id: s.owner_id })),
    leagues: ctx.leagues.map((l) => ({ id: l.id, name: l.name, sport_id: l.sport_id, owner_id: l.owner_id })),
    bookmakers: ctx.bookmakers.filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name, key: b.key, is_exchange: b.is_exchange, default_commission: Number(b.default_commission), owner_id: b.owner_id })),
    strategies: ctx.strategies.map((s) => ({ id: s.id, name: s.name, color: s.color, is_active: s.is_active })),
    marketTypes: ctx.marketTypes.map((m) => ({ id: m.id, name: m.name, key: m.key, category: m.category, has_line: m.has_line, outcomes: m.outcomes, sport_id: m.sport_id, settlement: m.settlement, owner_id: m.owner_id })),
    rangeLabel: `${range.label} · ${range.basis === "placed" ? "placed" : range.basis === "event" ? "event date" : "settled"}`,
    range: { preset: range.preset, from: range.from ?? null, to: range.to ?? null, basis: range.basis },
    timeZone: range.timeZone,
    unreadAlerts: ctx.unreadAlerts,
  };
  return <AppDataProvider value={value}><Shell>{children}</Shell></AppDataProvider>;
}
