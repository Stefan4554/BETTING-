import type { OddsProvider } from "./types";
import { theOddsApi } from "./the-odds-api";
import { apiFootball } from "./api-football";

/** Implemented adapters. Providers listed in odds_providers without an adapter show as "not available". */
export const PROVIDERS: Record<string, OddsProvider> = { [theOddsApi.id]: theOddsApi, [apiFootball.id]: apiFootball };
export const getProvider = (id: string): OddsProvider | null => PROVIDERS[id] ?? null;
