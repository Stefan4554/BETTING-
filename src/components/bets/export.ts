"use client";
import type { BetView } from "./tracker";
import { clv, type ClvConvention } from "@/lib/finance/clv";
import { csvCell, downloadBlob, toCsv } from "@/lib/export";

export const EXPORT_COLUMNS: [string, (b: BetView, conv: ClvConvention) => unknown][] = [
  ["ref", (b) => b.ref], ["placed_at", (b) => b.placed_at], ["settled_at", (b) => b.settled_at], ["sport", (b) => b.sport], ["league", (b) => b.league],
  ["event", (b) => b.event_name], ["home", (b) => b.home], ["away", (b) => b.away], ["event_start", (b) => b.event_start], ["timing", (b) => (b.is_live ? "live" : "prematch")],
  ["market", (b) => b.market], ["line", (b) => b.line], ["selection", (b) => b.selection], ["side", (b) => b.side], ["type", (b) => b.kind],
  ["bookmaker", (b) => b.bookmaker], ["bankroll", (b) => b.bankroll], ["odds", (b) => b.odds], ["stake", (b) => b.stake], ["currency", (b) => b.currency],
  ["commission", (b) => b.commission], ["potential_payout", (b) => b.potential_payout], ["actual_payout", (b) => b.actual_payout], ["status", (b) => b.status],
  ["profit", (b) => b.profit], ["cashout_amount", (b) => b.cashout_amount || null], ["est_probability", (b) => b.est_probability],
  ["implied_probability", (b) => +(1 / b.odds).toFixed(6)], ["opening_odds", (b) => b.opening_odds], ["closing_odds", (b) => b.closing_odds],
  ["clv", (b, c) => { const v = clv(b.odds, b.closing_odds, c, b.side); return v == null ? null : +v.toFixed(6); }],
  ["strategy", (b) => b.strategy], ["confidence", (b) => b.confidence], ["units", (b) => b.units], ["tags", (b) => b.tags.join("|")],
  ["correlation_group", (b) => b.correlation_group], ["notes", (b) => b.notes],
];

export async function exportBets(bets: BetView[], format: "csv" | "xlsx", conv: ClvConvention) {
  const stamp = new Date().toISOString().slice(0, 10);
  const header = EXPORT_COLUMNS.map(([k]) => k);
  const rows = bets.map((b) => EXPORT_COLUMNS.map(([, f]) => f(b, conv)));
  if (format === "csv") return downloadBlob(new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" }), `bets-${stamp}.csv`);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bets");
  ws.addRow(header).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" ? csvCell(v, false) : v)));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `bets-${stamp}.xlsx`);
}
