import "server-only";
import type { AppContext } from "./context";
import { loadAnalyticsBase } from "./analytics";
import { groupBy, pnlByPeriod, summarize, type BetRecord } from "@/lib/finance/metrics";
import { basisTime, BASIS_LABEL, inRange, isValidTimeZone, periodKey, resolveRange, usesFallback, type DateBasis } from "@/lib/finance/dates";
import { riskState } from "@/lib/finance/risk";
import { clv } from "@/lib/finance/clv";
import { position } from "@/lib/finance/trading";
import { executionsOf } from "./data";
import { fmtMoney, fmtNum, fmtOdds, fmtPct, fmtPp, TX_LABEL } from "@/lib/format";

export const REPORT_TYPES = {
  daily: "Daily P&L", weekly: "Weekly P&L", monthly: "Monthly P&L", annual: "Annual summary", sport: "Sport report", bookmaker: "Bookmaker report",
  strategy: "Strategy report", clv: "CLV report", risk: "Risk report", bankroll: "Bankroll statement", live: "Live trading report",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export interface ReportTable { title: string; columns: string[]; rows: (string | number | null)[][] }
export interface Report { title: string; period: string; generatedAt: string; currency: string; workspace: "live" | "demo"; summary: [string, string][]; tables: ReportTable[]; notes: string[] }

export async function buildReport(ctx: AppContext, type: ReportType, from: string | null, to: string | null, filter?: string | null, basisIn?: DateBasis): Promise<Report> {
  const base = await loadAnalyticsBase(ctx);
  const c = ctx.displayCurrency, conv = ctx.settings.clv_convention;
  const basis: DateBasis = basisIn ?? (ctx.settings.date_basis as DateBasis) ?? "placed";
  const tz = isValidTimeZone(ctx.settings.timezone) ? ctx.settings.timezone : "UTC";
  const range = resolveRange("custom", new Date(), { from, to }, tz, basis);
  const series = { basis, timeZone: tz };
  // Non-bet records (ledger, trades) use their own timestamp with the same local-day boundaries.
  const inP = (iso: string) => { const t = Date.parse(iso); return (!range.from || t >= range.from.getTime()) && (!range.to || t < range.to.getTime()); };
  let bets = base.conv.records.filter((b) => inRange(b, range));
  if (filter && type === "sport") bets = bets.filter((b) => b.sport === filter);
  if (filter && type === "bookmaker") bets = bets.filter((b) => b.bookmaker === filter);
  if (filter && type === "strategy") bets = bets.filter((b) => (b.strategy ?? "No strategy") === filter);
  const s = summarize(bets, { convention: conv, capital: base.capital, bankroll: base.totals.equity });
  const m = (v: number | null) => fmtMoney(v, c);
  const clvF = (v: number | null) => (conv === "odds" ? fmtPct(v, 2, true) : fmtPp(v));
  const summary: [string, string][] = [
    ["Bets (settled / pending)", `${fmtNum(s.totalBets)} (${s.settledBets} / ${s.pendingBets})`], ["Total stake (settled)", m(s.totalStake)], ["Net P/L", fmtMoney(s.netProfit, c, true)],
    ["ROI / Yield", fmtPct(s.roi, 2, true)], ["Win rate", fmtPct(s.winRate)], ["Average odds", fmtOdds(s.averageOdds)], ["Profit factor", s.profitFactor?.toFixed(2) ?? "—"],
    ["Max drawdown", `${m(-s.drawdown.maxAmount)} (${fmtPct(s.drawdown.maxPct)})`], [`Average CLV (${conv})`, `${clvF(s.averageClv)} (n=${s.clvSample})`],
    ["Expected profit (EV)", fmtMoney(s.expectedProfit, c, true)], ["Longest win / loss streak", `${s.longestWinStreak} / ${s.longestLossStreak}`],
  ];
  const groupTable = (title: string, label: string, rows: ReturnType<typeof groupBy>): ReportTable => ({
    title, columns: [label, "Bets", "Stake", "P/L", "ROI", "Win %", "Avg odds", "CLV", "n CLV"],
    rows: rows.map((r) => [r.key, r.bets, round(r.stake), round(r.profit), pct(r.roi), pct(r.winRate), r.averageOdds == null ? null : +r.averageOdds.toFixed(2), r.averageClv == null ? null : +(r.averageClv * 100).toFixed(2), r.clvSample]),
  });
  const periodTable = (title: string, g: "day" | "week" | "month"): ReportTable => ({
    title, columns: ["Period", "Bets", "Stake", "P/L", "ROI %", "Win %"],
    rows: pnlByPeriod(bets, g, series).map((r) => [r.period, r.bets, round(r.stake), round(r.profit), pct(r.roi), pct(r.winRate)]),
  });
  const betList = (list: BetRecord[]): ReportTable => ({
    title: "Bets", columns: ["#", "Placed", "Sport", "Event", "Market", "Selection", "Book", "Odds", "Stake", "Status", "P/L", "CLV %"],
    rows: list.slice(0, 2000).map((b) => [b.ref ?? "", b.placedAt.slice(0, 16).replace("T", " "), b.sport, b.eventName, b.market, b.selection ?? "", b.bookmaker ?? "", b.odds, round(b.stake), b.status, b.profit == null ? null : round(b.profit),
      (() => { const v = clv(b.odds, b.closingOdds, conv, b.side); return v == null ? null : +(v * 100).toFixed(2); })()]),
  });
  const tables: ReportTable[] = [];
  const notes: string[] = [`Amounts in ${c}. ROI and yield are both net profit / settled stake.`, `Bets selected and grouped by ${BASIS_LABEL[basis]}; day boundaries in ${tz}.`, "Statistics on fewer than 30 settled bets are highly uncertain."];
  if (basis === "event") { const n = bets.filter((b) => usesFallback(b, "event")).length; if (n) notes.push(`${n} bet(s) without an event date are dated by placement.`); }
  if (basis === "settled" && (from || to)) notes.push("Pending bets have no settlement date and are excluded.");
  switch (type) {
    case "daily": tables.push(periodTable("Daily P&L", "day"), betList(bets)); break;
    case "weekly": tables.push(periodTable("Weekly P&L (ISO weeks, Monday start)", "week")); break;
    case "monthly": tables.push(periodTable("Monthly P&L", "month"), groupTable("By sport", "Sport", groupBy(bets, (b) => b.sport, conv))); break;
    case "annual": {
      const years = groupBy(bets.filter((b) => b.status !== "pending"), (b) => periodKey(basisTime(b, basis), "month", tz).slice(0, 4), conv).sort((a, b) => a.key.localeCompare(b.key));
      tables.push(groupTable("By year", "Year", years), periodTable("By month", "month"), groupTable("By sport", "Sport", groupBy(bets, (b) => b.sport, conv)), groupTable("By strategy", "Strategy", groupBy(bets, (b) => b.strategy ?? "No strategy", conv)));
      break;
    }
    case "sport": tables.push(groupTable("By sport", "Sport", groupBy(bets, (b) => b.sport, conv)), groupTable("By league", "League", groupBy(bets, (b) => b.league ?? "—", conv)), groupTable("By market", "Market", groupBy(bets, (b) => b.market, conv))); break;
    case "bookmaker": tables.push(groupTable("By bookmaker", "Bookmaker", groupBy(bets, (b) => b.bookmaker ?? "—", conv)), groupTable("By sport", "Sport", groupBy(bets, (b) => b.sport, conv))); break;
    case "strategy": tables.push(groupTable("By strategy", "Strategy", groupBy(bets, (b) => b.strategy ?? "No strategy", conv)), periodTable("Monthly", "month")); break;
    case "clv": {
      const withClv = bets.filter((b) => b.closingOdds != null && b.kind === "single");
      tables.push(groupTable("CLV by sport", "Sport", groupBy(withClv, (b) => b.sport, conv)), groupTable("CLV by bookmaker", "Bookmaker", groupBy(withClv, (b) => b.bookmaker ?? "—", conv)),
        groupTable("CLV by market", "Market", groupBy(withClv, (b) => b.market, conv)), betList(withClv));
      notes.push(conv === "odds" ? "CLV convention: odds-based, taken / closing − 1." : "CLV convention: probability-based, closing implied − entry implied (percentage points).");
      break;
    }
    case "risk": {
      const st = riskState(base.conv.records, base.tradeExp, base.totals.equity);
      summary.push(["Open exposure", m(st.totalExposure)], ["Exposure % of bankroll", fmtPct(st.exposurePctOfBankroll)], ["Today / week P/L", `${fmtMoney(st.dailyPnl, c, true)} / ${fmtMoney(st.weeklyPnl, c, true)}`], ["Largest event share", fmtPct(st.concentration)]);
      const ex = (title: string, rows: typeof st.byEvent): ReportTable => ({ title, columns: ["", "Positions", "Exposure", "Share %"], rows: rows.map((r) => [r.key, r.bets, round(r.exposure), pct(r.share)]) });
      tables.push(ex("Exposure by event", st.byEvent), ex("Exposure by sport", st.bySport), ex("Exposure by bookmaker", st.byBookmaker), ex("Correlation groups", st.byCorrelationGroup));
      notes.push("Risk report reflects open positions now, regardless of the date range.");
      break;
    }
    case "bankroll": {
      const txs = base.txs.filter((t) => inP(t.occurred_at));
      const name = (id: string) => ctx.bankrolls.find((b) => b.id === id)?.name ?? id;
      tables.push({ title: "Balances", columns: ["Bankroll", "Currency", "Cash balance", "Archived"], rows: ctx.bankrolls.map((b) => [b.name, b.currency, Number(b.balance), b.archived ? "yes" : ""]) });
      const byType = new Map<string, number>();
      for (const t of txs) byType.set(`${name(t.bankroll_id)}|${t.type}`, (byType.get(`${name(t.bankroll_id)}|${t.type}`) ?? 0) + Number(t.amount));
      tables.push({ title: "Flows by type", columns: ["Bankroll", "Type", "Amount"], rows: [...byType.entries()].map(([k, v]) => { const [b, ty] = k.split("|"); return [b!, TX_LABEL[ty!] ?? ty!, round(v)]; }) });
      tables.push({ title: "Ledger", columns: ["Time", "Bankroll", "Type", "Amount", "Balance after", "Note"], rows: txs.slice(-3000).map((t) => [t.occurred_at.slice(0, 16).replace("T", " "), name(t.bankroll_id), TX_LABEL[t.type] ?? t.type, Number(t.amount), Number(t.balance_after), t.note ?? ""]) });
      notes.push("Ledger amounts are in each bankroll's own currency. Deposits, withdrawals, transfers and adjustments are capital flows, not profit.");
      break;
    }
    case "live": {
      const tr = base.trades.filter((t) => inP(t.opened_at));
      const closed = tr.filter((t) => t.status !== "open");
      summary.splice(0, summary.length, ["Trades (closed / open)", `${closed.length} / ${tr.length - closed.length}`], ["Realised P/L", fmtMoney(closed.reduce((a, t) => a + Number(t.realized_pnl ?? 0), 0), c, true)],
        ["Winning trades", fmtPct(closed.length ? closed.filter((t) => Number(t.realized_pnl) > 0).length / closed.length : null)],
        ["Live bets P/L", fmtMoney(bets.filter((b) => b.isLive).reduce((a, b) => a + (b.profit ?? 0), 0), c, true)]);
      tables.push({ title: "Trades", columns: ["Opened", "Closed", "Event", "Selection", "Executions", "Outcome", "Realised P/L", "Open exposure"],
        rows: tr.map((t) => [t.opened_at.slice(0, 16).replace("T", " "), t.closed_at?.slice(0, 16).replace("T", " ") ?? "", t.event_name, t.selection, t.trade_executions.length, t.outcome ?? "open",
          t.realized_pnl == null ? null : Number(t.realized_pnl), t.status === "open" ? position(executionsOf(t)).exposure : null]) });
      tables.push(groupTable("Live bets by sport", "Sport", groupBy(bets.filter((b) => b.isLive), (b) => b.sport, conv)));
      break;
    }
  }
  if (base.conv.unconverted) notes.push(`${base.conv.unconverted} bets excluded for missing exchange rates.`);
  return {
    title: `${REPORT_TYPES[type]}${filter ? ` — ${filter}` : ""}`, period: `${from ?? "first bet"} → ${to ?? "today"} · by ${BASIS_LABEL[basis]}`, generatedAt: new Date().toISOString(),
    currency: c, workspace: ctx.isDemo ? "demo" : "live", summary: type === "live" || type === "bankroll" ? summary.slice(0, type === "bankroll" ? 0 : summary.length) : summary, tables, notes,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number | null) => (x == null ? null : +(x * 100).toFixed(2));
