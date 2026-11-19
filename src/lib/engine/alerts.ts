/**
 * Alert rule evaluation. Pure: takes rules + a before/after view of the market and
 * returns notifications to emit. Persisting and delivering them is the caller's job.
 */
import type { MatchStatus } from "../domain";

export type AlertType =
  | "odds_move_pct" | "best_odds_available" | "value_edge_threshold" | "market_change"
  | "match_start" | "match_status_change" | "model_probability_change";

export interface AlertRule {
  id: string;
  type: AlertType;
  /** odds_move_pct / market_change / model_probability_change: fraction (0.05 = 5%).
   *  value_edge_threshold: EV fraction. best_odds_available: target decimal price. */
  threshold: number | null;
  matchId: string | null;
  selection?: string | null;
  active: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  channels: ("in_app" | "email")[];
}

export interface MarketState {
  matchId: string;
  label: string;
  status: MatchStatus;
  scheduledAt: string;
  /** Best price per selection. */
  best: Record<string, number>;
  /** No-vig consensus per selection. */
  consensus: Record<string, number>;
  modelProbability: Record<string, number | null>;
  /** Best EV per selection. */
  ev: Record<string, number | null>;
}

export interface AlertEvent {
  ruleId: string;
  matchId: string;
  title: string;
  body: string;
  channels: AlertRule["channels"];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function evaluateAlerts(rules: AlertRule[], prev: Map<string, MarketState>, next: Map<string, MarketState>, now = new Date()): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.lastTriggeredAt && now.getTime() - Date.parse(rule.lastTriggeredAt) < rule.cooldownMinutes * 60_000) continue;
    const targets = rule.matchId ? [rule.matchId] : [...next.keys()];
    for (const id of targets) {
      const n = next.get(id);
      if (!n) continue;
      const p = prev.get(id);
      const sels = rule.selection ? [rule.selection] : Object.keys(n.best);
      const emit = (title: string, body: string) => out.push({ ruleId: rule.id, matchId: id, title, body, channels: rule.channels });

      switch (rule.type) {
        case "odds_move_pct":
          for (const s of sels) {
            const a = p?.best[s], b = n.best[s];
            if (a && b && rule.threshold !== null && Math.abs(b - a) / a >= rule.threshold)
              emit(`Odds move ${n.label}`, `${s}: ${a.toFixed(2)} → ${b.toFixed(2)} (${pct((b - a) / a)})`);
          }
          break;
        case "market_change":
          for (const s of sels) {
            const a = p?.consensus[s], b = n.consensus[s];
            if (a !== undefined && b !== undefined && rule.threshold !== null && Math.abs(b - a) >= rule.threshold)
              emit(`Consensus shift ${n.label}`, `${s}: ${pct(a)} → ${pct(b)}`);
          }
          break;
        case "best_odds_available":
          for (const s of sels) {
            const b = n.best[s], a = p?.best[s];
            if (rule.threshold !== null && b !== undefined && b >= rule.threshold && !(a !== undefined && a >= rule.threshold))
              emit(`Target price hit ${n.label}`, `${s} now ${b.toFixed(2)} (target ${rule.threshold.toFixed(2)})`);
          }
          break;
        case "value_edge_threshold":
          for (const s of sels) {
            const ev = n.ev[s], before = p?.ev[s];
            if (rule.threshold !== null && ev != null && ev >= rule.threshold && !(before != null && before >= rule.threshold))
              emit(`Value edge ${n.label}`, `${s}: model EV ${pct(ev)} (threshold ${pct(rule.threshold)})`);
          }
          break;
        case "model_probability_change":
          for (const s of sels) {
            const a = p?.modelProbability[s], b = n.modelProbability[s];
            if (a != null && b != null && rule.threshold !== null && Math.abs(b - a) >= rule.threshold)
              emit(`Model update ${n.label}`, `${s}: ${pct(a)} → ${pct(b)}`);
          }
          break;
        case "match_start":
          if (p && p.status === "scheduled" && n.status === "live") emit(`Match started`, n.label);
          break;
        case "match_status_change":
          if (p && p.status !== n.status) emit(`Status change ${n.label}`, `${p.status} → ${n.status}`);
          break;
      }
    }
  }
  return out;
}
