"use client";
import * as React from "react";

export interface Opt { id: string; name: string }
export interface AppData {
  userEmail: string | null;
  isDemo: boolean;
  displayCurrency: string;
  oddsFormat: "decimal" | "american" | "fractional";
  unitSize: number;
  kellyFraction: number;
  defaultBankrollId: string | null;
  bankrolls: { id: string; name: string; currency: string; balance: number; archived: boolean; kind: string }[];
  sports: { id: string; name: string; key: string; has_draw: boolean; owner_id: string | null }[];
  leagues: { id: string; name: string; sport_id: string; owner_id: string | null }[];
  bookmakers: { id: string; name: string; key: string; is_exchange: boolean; default_commission: number; owner_id: string | null }[];
  strategies: { id: string; name: string; color: string; is_active: boolean }[];
  marketTypes: { id: string; name: string; key: string; category: string; has_line: boolean; outcomes: string[]; sport_id: string | null; settlement: string; owner_id: string | null }[];
  rangeLabel: string;
  range: { preset: string; from?: string | null; to?: string | null };
  unreadAlerts: number;
}

const Ctx = React.createContext<AppData | null>(null);
export function AppDataProvider({ value, children }: { value: AppData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAppData(): AppData {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAppData outside provider");
  return v;
}

/** Global "new bet" dialog trigger, so any page or the top bar can open the fast-entry form. */
export const NewBetContext = React.createContext<{ open: (prefill?: Record<string, unknown>) => void }>({ open: () => {} });
export const useNewBet = () => React.useContext(NewBetContext);
