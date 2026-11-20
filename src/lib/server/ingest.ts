import "server-only";
import type { DB } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers/registry";
import { onUsage, type UsageRecord } from "@/lib/providers/http";
import type { NormalizedEvent, ProviderConfig } from "@/lib/providers/types";
import { decryptSecret } from "./crypto";

/** Snapshots are stored when the price/line/suspension changes, or every HEARTBEAT minutes as a keep-alive. */
const HEARTBEAT_MS = 30 * 60_000;

export interface IngestResult { events: number; markets: number; snapshots: number; closing: number; alerts: number; errors: string[]; quota?: { used: number | null; remaining: number | null } }

export interface ConnectionRow {
  id: string; user_id: string; provider_id: string; config: Record<string, unknown>; last_success_at: string | null;
}

export function connectionConfig(c: ConnectionRow, apiKey: string): ProviderConfig & { refreshSeconds: number } {
  const cfg = c.config as { regions?: string; markets?: string; sports?: string[]; season?: number; refresh_seconds?: number };
  return { apiKey, regions: cfg.regions, markets: cfg.markets, sports: cfg.sports ?? [], season: cfg.season, refreshSeconds: Math.max(60, cfg.refresh_seconds ?? 600) };
}

export async function loadConnectionKey(admin: DB, connectionId: string): Promise<string | null> {
  const { data } = await admin.from("api_connection_secrets").select("ciphertext").eq("connection_id", connectionId).maybeSingle();
  return data ? decryptSecret(data.ciphertext) : null;
}

/**
 * Pull odds for one connection and store normalised events, markets and price history.
 * owner_id = the connection's user (data fetched with a user's key stays private to them);
 * pass ownerId = null for platform-wide ingestion with the env key.
 */
export async function ingest(admin: DB, opts: { providerId: string; config: ProviderConfig; ownerId: string | null; connectionId?: string; userIdForLogs?: string | null }): Promise<IngestResult> {
  const provider = getProvider(opts.providerId);
  const res: IngestResult = { events: 0, markets: 0, snapshots: 0, closing: 0, alerts: 0, errors: [] };
  if (!provider) { res.errors.push(`No adapter for ${opts.providerId}`); return res; }
  const logs: UsageRecord[] = [];
  const off = onUsage((r) => { if (r.provider === opts.providerId) logs.push(r); });
  try {
    const [{ data: sports }, { data: leagues }, { data: books }] = await Promise.all([
      admin.from("sports").select("id, key").is("owner_id", null),
      admin.from("leagues").select("id, provider_keys").is("owner_id", null),
      admin.from("bookmakers").select("id, key, provider_keys").is("owner_id", null),
    ]);
    const sportId = (k: string) => sports?.find((s) => s.key === k)?.id ?? sports?.find((s) => s.key === "other")!.id;
    const leagueId = (pk: string) => leagues?.find((l) => (l.provider_keys as Record<string, string>)?.[opts.providerId] === pk)?.id ?? null;
    const bookIds = new Map<string, string>();
    for (const b of books ?? []) {
      const pk = (b.provider_keys as Record<string, string>)?.[opts.providerId];
      if (pk) bookIds.set(pk, b.id);
      if (!bookIds.has(b.key)) bookIds.set(b.key, b.id);
    }
    const bookmaker = async (key: string, name: string) => {
      const hit = bookIds.get(key);
      if (hit) return hit;
      const { data } = await admin.from("bookmakers").insert({ key: key.slice(0, 60).replace(/[^a-z0-9_]/g, "_"), name, provider_keys: { [opts.providerId]: key } }).select("id").single();
      if (data) bookIds.set(key, data.id);
      return data?.id ?? null;
    };

    for (const sk of (opts.config.sports ?? []).slice(0, 12)) {
      let events: NormalizedEvent[];
      try {
        const r = await provider.fetchOdds(opts.config, sk);
        events = r.events;
        res.quota = { used: r.quota.used, remaining: r.quota.remaining };
      } catch (e) { res.errors.push(`${sk}: ${(e as Error).message}`); continue; }
      if (!events.length) continue;

      // Events (upsert on provider + external id + owner)
      const now = new Date().toISOString();
      const evRows = events.map((e) => ({
        owner_id: opts.ownerId, is_demo: false, sport_id: sportId(e.sportKey)!, league_id: leagueId(e.providerSportKey), name: e.name, home: e.home, away: e.away,
        start_time: e.startTime, status: (e.isLive ? "live" : "scheduled") as "live" | "scheduled", provider: opts.providerId, external_id: e.externalId, last_synced_at: now,
      }));
      const owned = opts.ownerId
        ? (await admin.from("events").select("id, external_id").eq("provider", opts.providerId).eq("owner_id", opts.ownerId).in("external_id", evRows.map((e) => e.external_id))).data ?? []
        : (await admin.from("events").select("id, external_id").eq("provider", opts.providerId).is("owner_id", null).in("external_id", evRows.map((e) => e.external_id))).data ?? [];
      const evId = new Map(owned.map((e) => [e.external_id!, e.id]));
      for (const row of evRows) {
        const id = evId.get(row.external_id);
        if (id) await admin.from("events").update({ status: row.status, start_time: row.start_time, last_synced_at: now, league_id: row.league_id }).eq("id", id);
        else {
          const { data, error } = await admin.from("events").insert(row).select("id").single();
          if (error) { res.errors.push(error.message); continue; }
          evId.set(row.external_id, data.id);
        }
      }
      res.events += events.length;

      // Markets
      const ids = [...evId.values()];
      const { data: mks } = await admin.from("markets").select("id, event_id, key, line").in("event_id", ids);
      const mkId = new Map((mks ?? []).map((m) => [`${m.event_id}|${m.key}|${m.line == null ? "" : Number(m.line)}`, m.id]));
      for (const e of events) {
        const eid = evId.get(e.externalId);
        if (!eid) continue;
        for (const m of e.markets) {
          const k = `${eid}|${m.key}|${m.line ?? ""}`;
          if (mkId.has(k)) continue;
          const { data } = await admin.from("markets").insert({ event_id: eid, key: m.key, name: m.name, line: m.line }).select("id").single();
          if (data) { mkId.set(k, data.id); res.markets++; }
        }
      }

      // Snapshots: only changes (or heartbeat)
      const marketIds = [...new Set([...mkId.values()])];
      const { data: latest } = await admin.rpc("latest_snapshots", { p_markets: marketIds });
      const last = new Map((latest ?? []).map((s) => [`${s.market_id}|${s.bookmaker_id}|${s.selection}`, s]));
      const snaps: { owner_id: string | null; is_demo: boolean; event_id: string; market_id: string; bookmaker_id: string; selection: string; line: number | null; odds: number; is_live: boolean; provider: string; provider_updated_at: string | null; captured_at: string }[] = [];
      for (const e of events) {
        const eid = evId.get(e.externalId);
        if (!eid) continue;
        for (const m of e.markets) {
          const mid = mkId.get(`${eid}|${m.key}|${m.line ?? ""}`);
          if (!mid) continue;
          for (const q of m.quotes) {
            const bid = await bookmaker(q.bookmakerKey, q.bookmakerName);
            if (!bid) continue;
            const prev = last.get(`${mid}|${bid}|${q.selection}`);
            const changed = !prev || Number(prev.odds) !== q.odds || (prev.line == null ? null : Number(prev.line)) !== q.line || prev.suspended;
            if (!changed && Date.now() - Date.parse(prev!.captured_at) < HEARTBEAT_MS) continue;
            snaps.push({ owner_id: opts.ownerId, is_demo: false, event_id: eid, market_id: mid, bookmaker_id: bid, selection: q.selection, line: q.line, odds: q.odds,
              is_live: e.isLive, provider: opts.providerId, provider_updated_at: q.updatedAt, captured_at: now });
          }
        }
      }
      for (let i = 0; i < snaps.length; i += 500) {
        const { error } = await admin.from("odds_snapshots").insert(snaps.slice(i, i + 500));
        if (error) res.errors.push(error.message); else res.snapshots += Math.min(500, snaps.length - i);
      }
    }

    await admin.rpc("mark_closing_odds");
    if (opts.ownerId) {
      const { data } = await admin.rpc("capture_closing_odds_for", { p_user: opts.ownerId });
      res.closing = Number(data ?? 0);
      res.alerts = await movementAlerts(admin, opts.ownerId);
    }
  } finally {
    off();
    if (logs.length) {
      await admin.from("api_request_logs").insert(logs.map((l) => ({
        user_id: opts.userIdForLogs ?? opts.ownerId, connection_id: opts.connectionId ?? null, provider_id: l.provider, endpoint: l.endpoint, status: l.status,
        duration_ms: l.durationMs, cache_hit: l.cacheHit, cost_units: l.costUnits, error: l.error, at: l.at,
      })));
    }
  }
  return res;
}

/** Alert on significant moves in markets where the user holds pending bets. */
async function movementAlerts(admin: DB, userId: string): Promise<number> {
  const { data: settings } = await admin.from("user_settings").select("alert_preferences").eq("user_id", userId).maybeSingle();
  const threshold = Number((settings?.alert_preferences as { odds_move_pct?: number } | null)?.odds_move_pct ?? 0.08);
  const { data: bets } = await admin.from("bets").select("id, ref, market_id, bookmaker_id, selection, odds, event_name").eq("user_id", userId).eq("status", "pending").is("deleted_at", null).not("market_id", "is", null);
  if (!bets?.length) return 0;
  const { data: latest } = await admin.rpc("latest_snapshots", { p_markets: [...new Set(bets.map((b) => b.market_id!))] });
  const day = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const b of bets) {
    const cur = (latest ?? []).find((s) => s.market_id === b.market_id && s.selection.toLowerCase() === b.selection.toLowerCase() && (!b.bookmaker_id || s.bookmaker_id === b.bookmaker_id));
    if (!cur) continue;
    const move = Number(cur.odds) / Number(b.odds) - 1;
    if (Math.abs(move) < threshold) continue;
    rows.push({ user_id: userId, is_demo: false, type: "odds_movement", severity: "info" as const, title: `Odds ${move < 0 ? "shortened" : "drifted"} ${(move * 100).toFixed(1)}% on bet #${b.ref}`,
      body: `${b.event_name} — ${b.selection}: taken ${Number(b.odds).toFixed(2)}, now ${Number(cur.odds).toFixed(2)}`, data: { bet_id: b.id, move }, dedupe_key: `odds:${b.id}:${day}` });
  }
  if (!rows.length) return 0;
  await admin.from("alerts").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  return rows.length;
}
