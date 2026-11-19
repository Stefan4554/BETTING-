"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { evaluateAlerts, type AlertEvent, type AlertRule, type AlertType, type MarketState } from "@/lib/engine/alerts";
import { fmtAgo } from "@/lib/format";
import { EmptyState, Panel } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabaseBrowser } from "@/lib/supabase/client";

const TYPES: { type: AlertType; label: string; unit: string; hint: string }[] = [
  { type: "odds_move_pct", label: "Odds move above %", unit: "%", hint: "Best price moves by at least this % between checks" },
  { type: "best_odds_available", label: "Best odds reach target", unit: "odds", hint: "Best available price crosses this decimal price" },
  { type: "value_edge_threshold", label: "Value edge exceeds %", unit: "%", hint: "Model EV crosses this threshold (suspect edges excluded)" },
  { type: "market_change", label: "Consensus shifts by pts", unit: "%", hint: "No-vig market probability changes by this many points" },
  { type: "model_probability_change", label: "Model probability changes", unit: "%", hint: "Model probability changes by this many points" },
  { type: "match_start", label: "Match starts", unit: "", hint: "Scheduled → live" },
  { type: "match_status_change", label: "Match status changes", unit: "", hint: "Suspended, delayed, interrupted, completed…" },
];

type Note = { id: string | number; title: string; body: string; at: string; read: boolean };
const LS_RULES = "edge.alert.rules", LS_NOTES = "edge.alert.notes", LS_STATE = "edge.alert.state";
const ls = { get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

export function AlertsView({ mode, userId, matches }: { mode: "server" | "browser"; userId: string | null; matches: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [form, setForm] = useState({ type: "odds_move_pct" as AlertType, threshold: "5", matchId: "", email: false, cooldown: "30" });
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<Map<string, MarketState>>(new Map());

  // Server mode: rules + notifications from Supabase, realtime push for new notifications.
  const server = useQuery({
    queryKey: ["alerts"],
    enabled: mode === "server",
    queryFn: async () => (await (await fetch("/api/alerts")).json()) as { rules: Record<string, unknown>[]; notifications: Record<string, unknown>[] },
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (mode !== "server" || !userId) return;
    const sb = supabaseBrowser();
    if (!sb) return;
    const ch = sb.channel("notifications").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => qc.invalidateQueries({ queryKey: ["alerts"] })).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [mode, userId, qc]);

  // Browser mode: rules in localStorage, evaluated here against /api/market-state.
  useEffect(() => {
    if (mode !== "browser") return;
    setRules(ls.get(LS_RULES, []));
    setNotes(ls.get(LS_NOTES, []));
    prev.current = new Map(ls.get<[string, MarketState][]>(LS_STATE, []));
  }, [mode]);
  const states = useQuery({
    queryKey: ["market-state"],
    enabled: mode === "browser",
    queryFn: async () => (await (await fetch("/api/market-state")).json()) as { at: string; states: MarketState[] },
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (mode !== "browser" || !states.data) return;
    const next = new Map(states.data.states.map((s) => [s.matchId, s]));
    const current: AlertRule[] = ls.get(LS_RULES, []);
    if (prev.current.size) {
      const events: AlertEvent[] = evaluateAlerts(current, prev.current, next);
      if (events.length) {
        const now = new Date().toISOString();
        const fired = new Set(events.map((e) => e.ruleId));
        const updatedRules = current.map((r) => (fired.has(r.id) ? { ...r, lastTriggeredAt: now } : r));
        const n = [...events.map((e, i) => ({ id: `${now}-${i}`, title: e.title, body: e.body, at: now, read: false })), ...ls.get<Note[]>(LS_NOTES, [])].slice(0, 200);
        ls.set(LS_RULES, updatedRules); ls.set(LS_NOTES, n);
        setRules(updatedRules); setNotes(n);
      }
    }
    prev.current = next;
    ls.set(LS_STATE, [...next.entries()]);
  }, [mode, states.data]);

  const meta = TYPES.find((t) => t.type === form.type)!;
  const add = async () => {
    setError(null);
    const raw = Number(form.threshold);
    const threshold = meta.unit === "" ? null : meta.unit === "%" ? raw / 100 : raw;
    if (meta.unit && !(raw > 0)) return setError("Enter a positive threshold.");
    const rule = { type: form.type, threshold, matchId: form.matchId || null, channels: form.email ? ["in_app", "email"] : ["in_app"], cooldownMinutes: Math.max(1, Number(form.cooldown) || 30), active: true };
    if (mode === "server") {
      const r = await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rule) });
      if (!r.ok) return setError("Could not save rule.");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } else {
      const n = [{ ...rule, id: crypto.randomUUID(), lastTriggeredAt: null, channels: ["in_app" as const] }, ...rules] as AlertRule[];
      setRules(n); ls.set(LS_RULES, n);
    }
  };
  const toggle = async (id: string, active: boolean) => {
    if (mode === "server") { await fetch("/api/alerts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, active }) }); qc.invalidateQueries({ queryKey: ["alerts"] }); }
    else { const n = rules.map((r) => (r.id === id ? { ...r, active } : r)); setRules(n); ls.set(LS_RULES, n); }
  };
  const del = async (id: string) => {
    if (mode === "server") { await fetch(`/api/alerts?id=${id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["alerts"] }); }
    else { const n = rules.filter((r) => r.id !== id); setRules(n); ls.set(LS_RULES, n); }
  };

  const shownRules: AlertRule[] = mode === "server"
    ? (server.data?.rules ?? []).map((r) => ({ id: String(r.id), type: r.type as AlertType, threshold: r.threshold == null ? null : Number(r.threshold), matchId: (r.match_ref as string) ?? null, active: Boolean(r.active), cooldownMinutes: Number(r.cooldown_minutes), lastTriggeredAt: (r.last_triggered_at as string) ?? null, channels: r.channels as AlertRule["channels"] }))
    : rules;
  const shownNotes: Note[] = mode === "server"
    ? (server.data?.notifications ?? []).map((n) => ({ id: Number(n.id), title: String(n.title), body: String(n.body ?? ""), at: String(n.created_at), read: n.read_at != null }))
    : notes;
  const label = (r: AlertRule) => { const t = TYPES.find((x) => x.type === r.type)!; return r.threshold == null ? t.label : `${t.label} ${t.unit === "%" ? (r.threshold * 100).toFixed(1) + "%" : r.threshold.toFixed(2)}`; };

  return (
    <>
      <div className="rounded-[3px] border border-line-strong bg-panel-2 px-3 py-1.5 text-xs text-muted">
        {mode === "server"
          ? "Rules are evaluated on the server every 10 minutes (cron) and stored in your account; new notifications arrive in real time."
          : "Rules are stored in this browser and evaluated here every 30s while this page is open. Sign in with Supabase configured for server-side evaluation and email delivery."}
      </div>
      <Panel title="New rule">
        <div className="flex flex-wrap items-end gap-2 p-3">
          <Label>Trigger<Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AlertType })}>{TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select></Label>
          {meta.unit && <Label className="w-24">Threshold {meta.unit === "%" ? "(%)" : "(odds)"}<Input value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Label>}
          <Label className="w-64">Match<Select value={form.matchId} onChange={(e) => setForm({ ...form, matchId: e.target.value })}><option value="">Any match</option>{matches.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Label>
          <Label className="w-24">Cooldown (min)<Input value={form.cooldown} onChange={(e) => setForm({ ...form, cooldown: e.target.value })} /></Label>
          {mode === "server" && <label className="flex items-center gap-1 pb-1 text-xs text-muted"><input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} /> also email</label>}
          <Button onClick={add}>Add rule</Button>
          <span className="pb-1 text-[11px] text-dim">{meta.hint}</span>
          {error && <span className="text-xs text-down">{error}</span>}
        </div>
      </Panel>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Rules" subtitle={`${shownRules.length}`}>
          {shownRules.length === 0 ? <EmptyState icon="info" title="No alert rules yet" /> : (
            <Table>
              <THead><TR><TH>Rule</TH><TH>Match</TH><TH>Channels</TH><TH>Last fired</TH><TH>Active</TH><TH /></TR></THead>
              <tbody>{shownRules.map((r) => (
                <TR key={r.id}>
                  <TD>{label(r)}</TD>
                  <TD className="max-w-48 truncate text-muted">{r.matchId ? matches.find((m) => m.id === r.matchId)?.label ?? r.matchId : "Any"}</TD>
                  <TD>{r.channels.map((c) => <Badge key={c} className="mr-1">{c}</Badge>)}</TD>
                  <TD className="num text-muted">{r.lastTriggeredAt ? fmtAgo(r.lastTriggeredAt) : "never"}</TD>
                  <TD><input type="checkbox" checked={r.active} onChange={(e) => toggle(r.id, e.target.checked)} /></TD>
                  <TD><button onClick={() => del(r.id)} className="text-[11px] text-dim hover:text-down">✕</button></TD>
                </TR>
              ))}</tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Notifications" subtitle={`${shownNotes.filter((n) => !n.read).length} unread`}>
          {shownNotes.length === 0 ? <EmptyState icon="info" title="No notifications yet">They appear when a rule's condition is met between two checks.</EmptyState> : (
            <ul className="divide-y divide-line/70">{shownNotes.slice(0, 100).map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-2 px-3 py-1.5 text-xs ${n.read ? "text-muted" : ""}`}>
                <span><span className="font-medium">{n.title}</span> · {n.body}</span>
                <span className="num shrink-0 text-dim">{fmtAgo(n.at)}</span>
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </>
  );
}
