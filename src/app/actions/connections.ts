"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret, last4 } from "@/lib/server/crypto";
import { connectionConfig, ingest, loadConnectionKey } from "@/lib/server/ingest";
import { getProvider } from "@/lib/providers/registry";
import { must, run } from "./util";

const cfgSchema = z.object({
  label: z.string().trim().min(1).max(40).default("default"),
  regions: z.string().regex(/^[a-z0-9,]*$/).max(40).optional(),
  markets: z.string().regex(/^[a-z0-9_,]*$/).max(120).optional(),
  sports: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  season: z.number().int().min(2000).max(2100).optional(),
  refresh_seconds: z.number().int().min(60).max(86_400).default(600),
});

function admin() {
  const a = supabaseAdmin();
  if (!a) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server: secure key storage and ingestion are unavailable.");
  return a;
}

/** Create or update a connection. The API key is encrypted server-side and never returned to the browser. */
export async function saveConnection(input: { id?: string; provider_id: string; api_key?: string; config: z.input<typeof cfgSchema>; is_enabled?: boolean }) {
  return run(async () => {
    const ctx = await getContext();
    const providerId = z.string().min(1).max(40).parse(input.provider_id);
    const { data: prov } = await ctx.sb.from("odds_providers").select("id, implemented, min_refresh_seconds").eq("id", providerId).single();
    if (!prov?.implemented) throw new Error("VALIDATION: this provider has no adapter in this release");
    const cfg = cfgSchema.parse(input.config);
    if (cfg.refresh_seconds < prov.min_refresh_seconds) cfg.refresh_seconds = prov.min_refresh_seconds;
    const key = input.api_key?.trim();
    if (key && (key.length < 8 || key.length > 200 || /\s/.test(key))) throw new Error("VALIDATION: that does not look like an API key");
    const { label, ...config } = cfg;
    let id = input.id;
    if (id) must(await ctx.sb.from("api_connections").update({ config, label, is_enabled: input.is_enabled ?? true, ...(key ? { key_last4: last4(key), status: "untested" } : {}) }).eq("id", id));
    else {
      if (!key) throw new Error("VALIDATION: an API key is required");
      const ins = await ctx.sb.from("api_connections").insert({ user_id: ctx.user.id, provider_id: providerId, label, config, key_last4: last4(key) }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      id = ins.data.id;
    }
    if (key) must(await admin().from("api_connection_secrets").upsert({ connection_id: id!, ciphertext: encryptSecret(key), updated_at: new Date().toISOString() }));
    return id!;
  });
}

export async function deleteConnection(id: string) {
  return run(async () => { const ctx = await getContext(); must(await ctx.sb.from("api_connections").delete().eq("id", id)); return id; });
}

async function ownConnection(id: string) {
  const ctx = await getContext();
  const r = await ctx.sb.from("api_connections").select("*").eq("id", z.string().uuid().parse(id)).single();   // RLS: own rows only
  if (r.error) throw new Error(r.error.message);
  const conn = r.data;
  return { ctx, conn };
}

export async function testConnection(id: string) {
  return run(async () => {
    const { ctx, conn } = await ownConnection(id);
    const a = admin();
    const key = await loadConnectionKey(a, conn.id);
    const provider = getProvider(conn.provider_id);
    if (!key || !provider) throw new Error("VALIDATION: connection has no stored key or adapter");
    const r = await provider.test(connectionConfig(conn as never, key));
    const status = r.ok ? "ok" : /429|quota|limit/i.test(r.message) ? "rate_limited" : "error";
    await ctx.sb.from("api_connections").update({
      status, last_tested_at: new Date().toISOString(), last_error: r.ok ? null : r.message,
      ...(r.ok ? { last_success_at: new Date().toISOString() } : {}), quota_used: r.quota?.used ?? conn.quota_used, quota_remaining: r.quota?.remaining ?? conn.quota_remaining,
    }).eq("id", conn.id);
    await a.from("api_request_logs").insert({ user_id: ctx.user.id, connection_id: conn.id, provider_id: conn.provider_id, endpoint: "connection test", status: r.ok ? 200 : null, duration_ms: r.latencyMs ?? null, error: r.ok ? null : r.message });
    if (!r.ok) await ctx.sb.from("alerts").insert({ user_id: ctx.user.id, is_demo: false, type: "api_failure", severity: "warning", title: `${provider.name} connection test failed`, body: r.message });
    return r;
  });
}

export async function listProviderSports(id: string) {
  return run(async () => {
    const { conn } = await ownConnection(id);
    const key = await loadConnectionKey(admin(), conn.id);
    const provider = getProvider(conn.provider_id);
    if (!key || !provider) throw new Error("VALIDATION: connection has no stored key");
    return (await provider.listSports(connectionConfig(conn as never, key))).filter((s) => s.active);
  }, false);
}

/** Manual refresh, throttled to the connection's refresh interval to protect the provider quota. */
export async function refreshConnection(id: string, force = false) {
  return run(async () => {
    const { ctx, conn } = await ownConnection(id);
    if (ctx.isDemo) throw new Error("VALIDATION: switch to the live workspace to ingest real odds");
    const a = admin();
    const key = await loadConnectionKey(a, conn.id);
    if (!key) throw new Error("VALIDATION: no stored key");
    const cfg = connectionConfig(conn as never, key);
    if (!cfg.sports?.length) throw new Error("VALIDATION: choose at least one sport/league to poll in the connection settings");
    const since = conn.last_success_at ? Date.now() - Date.parse(conn.last_success_at) : Infinity;
    if (!force && since < cfg.refreshSeconds * 1000) throw new Error(`VALIDATION: refreshed ${Math.round(since / 1000)}s ago; minimum interval is ${cfg.refreshSeconds}s`);
    const r = await ingest(a, { providerId: conn.provider_id, config: cfg, ownerId: ctx.user.id, connectionId: conn.id });
    const failed = r.errors.length > 0 && r.snapshots === 0 && r.events === 0;
    await ctx.sb.from("api_connections").update({
      status: failed ? "error" : "ok", last_error: r.errors[0] ?? null, ...(failed ? {} : { last_success_at: new Date().toISOString() }),
      quota_used: r.quota?.used ?? conn.quota_used, quota_remaining: r.quota?.remaining ?? conn.quota_remaining,
    }).eq("id", conn.id);
    if (failed) await ctx.sb.from("alerts").insert({ user_id: ctx.user.id, is_demo: false, type: "api_failure", severity: "warning", title: "Odds ingestion failed", body: r.errors.slice(0, 3).join(" · ") });
    return r;
  });
}
