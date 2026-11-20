"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { Badge } from "@/components/ui/badge";
import { KV, Notice, PageHeader, Panel } from "@/components/app/primitives";
import { useAppData } from "@/components/app/app-data";
import {
  addExchangeRate, addLeague, addMarketType, addSport, clearDemo, deleteCatalogItem, deleteExchangeRate, resetDemo, setMode, updateProfile, updateSettings,
} from "@/app/actions/settings";
import { deleteConnection, listProviderSports, refreshConnection, saveConnection, testConnection } from "@/app/actions/connections";
import { CURRENCIES, fmtAgo, fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Caps = { encryption: boolean; serviceRole: boolean; email: boolean; platformOddsKey: boolean };

export function SettingsView({ tab, settings, profile, email, rates, providers, connections, logs, demoBets, serverCaps }: {
  tab: string; settings: Tables<"user_settings">; profile: Tables<"profiles"> | null; email: string | null; rates: Tables<"exchange_rates">[];
  providers: Tables<"odds_providers">[]; connections: Tables<"api_connections">[]; logs: Tables<"api_request_logs">[]; demoBets: number; serverCaps: Caps;
}) {
  const router = useRouter();
  const save = async (patch: Parameters<typeof updateSettings>[0], msg = "Saved") => {
    const r = await updateSettings(patch);
    if (!r.ok) toast.error(r.error); else { toast.success(msg); router.refresh(); }
  };
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Settings" description={email ?? undefined} />
      <Tabs defaultValue={tab}>
        <TabsList>
          {[["general", "General"], ["currencies", "Currencies & FX"], ["catalog", "Sports & markets"], ["data", "Data sources"], ["demo", "Demo workspace"], ["account", "Account & security"]].map(([k, l]) => <TabsTrigger key={k} value={k!}>{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="general"><General settings={settings} save={save} /></TabsContent>
        <TabsContent value="currencies"><Currencies settings={settings} rates={rates} save={save} /></TabsContent>
        <TabsContent value="catalog"><Catalog /></TabsContent>
        <TabsContent value="data"><DataSources providers={providers} connections={connections} logs={logs} caps={serverCaps} /></TabsContent>
        <TabsContent value="demo"><Demo demoBets={demoBets} /></TabsContent>
        <TabsContent value="account"><Account profile={profile} email={email} caps={serverCaps} /></TabsContent>
      </Tabs>
    </div>
  );
}

function General({ settings, save }: { settings: Tables<"user_settings">; save: (p: Parameters<typeof updateSettings>[0], m?: string) => Promise<void> }) {
  const app = useAppData();
  const prefs = settings.alert_preferences as { large_result: number; odds_move_pct: number; email: boolean };
  const [f, setF] = React.useState({
    odds_format: settings.odds_format, theme: settings.theme, timezone: settings.timezone, clv_convention: settings.clv_convention,
    clv_reference_bookmaker: settings.clv_reference_bookmaker ?? "", default_kelly_fraction: String(settings.default_kelly_fraction), unit_size: String(settings.unit_size),
    default_bankroll_id: settings.default_bankroll_id ?? "", large_result: String(prefs.large_result ?? 250), odds_move_pct: String((prefs.odds_move_pct ?? 0.08) * 100), email: Boolean(prefs.email),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    document.cookie = `bep_theme=${f.theme}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.theme = f.theme;
    await save({
      odds_format: f.odds_format as "decimal", theme: f.theme as "dark", timezone: f.timezone, clv_convention: f.clv_convention,
      clv_reference_bookmaker: f.clv_reference_bookmaker || null, default_kelly_fraction: Number(f.default_kelly_fraction), unit_size: Number(f.unit_size),
      default_bankroll_id: f.default_bankroll_id || null, alert_preferences: { large_result: Number(f.large_result), odds_move_pct: Number(f.odds_move_pct) / 100, email: f.email },
    });
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel title="Display" bodyClassName="grid grid-cols-2 content-start gap-2 p-3">
        <Label>Odds format<Select value={f.odds_format} onChange={set("odds_format")}><option value="decimal">Decimal (2.50)</option><option value="american">American (+150)</option><option value="fractional">Fractional (3/2)</option></Select></Label>
        <Label>Theme<Select value={f.theme} onChange={set("theme")}><option value="dark">Charcoal (dark)</option><option value="darker">Black (OLED)</option><option value="light">Light</option></Select></Label>
        <Label>Timezone<Input value={f.timezone} onChange={set("timezone")} /></Label>
        <Label>Default bankroll<Select value={f.default_bankroll_id} onChange={set("default_bankroll_id")}><option value="">First bankroll</option>{app.bankrolls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Label>
      </Panel>
      <Panel title="Analytics conventions" bodyClassName="grid grid-cols-2 content-start gap-2 p-3">
        <Label className="col-span-2">CLV convention<Select value={f.clv_convention} onChange={set("clv_convention")}><option value="odds">Odds-based: taken / closing − 1</option><option value="probability">Probability-based: closing implied − entry implied (pp)</option></Select></Label>
        <Label className="col-span-2">CLV reference market (closing prices)<Select value={f.clv_reference_bookmaker} onChange={set("clv_reference_bookmaker")}><option value="">Each bet&apos;s own bookmaker</option>{app.bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Label>
        <Label>Default Kelly fraction<Input inputMode="decimal" value={f.default_kelly_fraction} onChange={set("default_kelly_fraction")} /></Label>
        <Label>Unit size<Input inputMode="decimal" value={f.unit_size} onChange={set("unit_size")} /></Label>
      </Panel>
      <Panel title="Notifications" bodyClassName="grid grid-cols-2 content-start gap-2 p-3">
        <Label>Large profit/loss alert ≥<Input inputMode="decimal" value={f.large_result} onChange={set("large_result")} /></Label>
        <Label>Odds movement alert ≥ %<Input inputMode="decimal" value={f.odds_move_pct} onChange={set("odds_move_pct")} /></Label>
        <label className="col-span-2 flex items-center gap-1.5 text-xs"><Checkbox checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} /> Also email critical alerts (requires the server email integration)</label>
        <p className="col-span-2 text-[11px] text-dim">Risk thresholds (daily loss, drawdown, exposure) are configured under Risk Management.</p>
      </Panel>
      <div className="lg:col-span-2"><Button onClick={submit}>Save settings</Button></div>
    </div>
  );
}

function Currencies({ settings, rates, save }: { settings: Tables<"user_settings">; rates: Tables<"exchange_rates">[]; save: (p: Parameters<typeof updateSettings>[0], m?: string) => Promise<void> }) {
  const router = useRouter();
  const [f, setF] = React.useState({ base: "EUR", quote: "USD", rate: "", as_of: new Date().toISOString().slice(0, 10) });
  const add = async () => {
    const r = await addExchangeRate({ ...f, rate: Number(f.rate) });
    if (!r.ok) toast.error(r.error); else { toast.success("Rate saved"); setF({ ...f, rate: "" }); router.refresh(); }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Panel title="Display currency" bodyClassName="p-3">
        <Select value={settings.display_currency} onChange={(e) => save({ display_currency: e.target.value }, "Display currency updated")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
        <p className="mt-2 text-[11px] text-dim">Dashboards convert each bankroll into this currency using the stored rate on or before each bet&apos;s placement date (historical snapshots). Amounts without a rate are excluded and flagged, never guessed.</p>
        <div className="label-xs mb-1 mt-4">Add / correct a rate</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Input inputMode="decimal" placeholder={`1 ${f.base} = ? ${f.quote}`} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          <Input type="date" value={f.as_of} onChange={(e) => setF({ ...f, as_of: e.target.value })} />
        </div>
        <Button className="mt-1.5 w-full" size="sm" onClick={add} disabled={!f.rate}>Save rate</Button>
      </Panel>
      <Panel title="Exchange-rate snapshots" subtitle="ECB reference feed (daily job) + your manual rates" className="lg:col-span-2">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs"><thead className="sticky top-0 bg-panel-2"><tr>{["Date", "Pair", "Rate", "Source", ""].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{rates.map((r) => (
              <tr key={r.id} className="border-b border-line/60"><td className="num h-7 px-2">{fmtDate(r.as_of)}</td><td className="px-2">{r.base}/{r.quote}</td><td className="num px-2">{Number(r.rate).toFixed(6)}</td>
                <td className="px-2 text-muted">{r.owner_id ? "manual" : r.source}</td>
                <td className="px-2">{r.owner_id && <Button size="icon" variant="ghost" aria-label="Delete rate" onClick={async () => { const x = await deleteExchangeRate(r.id); if (!x.ok) toast.error(x.error); else router.refresh(); }}><Trash2 className="h-3 w-3" /></Button>}</td></tr>
            ))}{!rates.length && <tr><td colSpan={5} className="py-6 text-center text-dim">No rates yet. Cross-currency bets require a rate (or an explicit rate entered on the bet).</td></tr>}</tbody></table>
        </div>
      </Panel>
    </div>
  );
}

function Catalog() {
  const app = useAppData();
  const router = useRouter();
  const [sport, setSport] = React.useState({ name: "", draw: false });
  const [league, setLeague] = React.useState({ sport: app.sports[0]?.id ?? "", name: "", country: "" });
  const [mk, setMk] = React.useState({ name: "", category: "other", sport_id: "", has_line: false, settlement: "binary", outcomes: "" });
  const done = (r: { ok: boolean; error?: string }, m: string) => { if (!r.ok) toast.error(r.error ?? "Failed"); else { toast.success(m); router.refresh(); } };
  const del = async (t: "sports" | "leagues" | "market_types", id: string) => done(await deleteCatalogItem(t, id), "Removed");
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <Panel title="Sports" subtitle={`${app.sports.length} available`} bodyClassName="p-3">
        <div className="flex gap-1.5"><Input placeholder="Custom sport" value={sport.name} onChange={(e) => setSport({ ...sport, name: e.target.value })} />
          <label className="flex items-center gap-1 text-[11px]"><Checkbox checked={sport.draw} onChange={(e) => setSport({ ...sport, draw: e.target.checked })} />draw</label>
          <Button size="sm" disabled={!sport.name} onClick={async () => { done(await addSport(sport.name, sport.draw), "Sport added"); setSport({ name: "", draw: false }); }}>Add</Button></div>
        <div className="mt-2 flex flex-wrap gap-1">{app.sports.map((s) => <Badge key={s.id} tone={s.owner_id ? "accent" : "neutral"}>{s.name}{s.owner_id && <button className="ml-1" onClick={() => del("sports", s.id)} aria-label={`Remove ${s.name}`}>×</button>}</Badge>)}</div>
      </Panel>
      <Panel title="Leagues / competitions" bodyClassName="p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={league.sport} onChange={(e) => setLeague({ ...league, sport: e.target.value })}>{app.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input placeholder="Country / region" value={league.country} onChange={(e) => setLeague({ ...league, country: e.target.value })} />
          <Input className="col-span-2" placeholder="League name" value={league.name} onChange={(e) => setLeague({ ...league, name: e.target.value })} />
        </div>
        <Button size="sm" className="mt-1.5" disabled={!league.name} onClick={async () => { done(await addLeague(league.sport, league.name, league.country), "League added"); setLeague({ ...league, name: "" }); }}>Add league</Button>
        <div className="mt-2 max-h-72 overflow-auto text-xs">{app.sports.map((s) => {
          const ls = app.leagues.filter((l) => l.sport_id === s.id);
          return ls.length ? <div key={s.id} className="mb-1"><div className="label-xs">{s.name}</div>{ls.map((l) => <div key={l.id} className="flex justify-between py-0.5"><span>{l.name}</span>{l.owner_id && <button className="text-dim hover:text-down" onClick={() => del("leagues", l.id)}>remove</button>}</div>)}</div> : null;
        })}</div>
      </Panel>
      <Panel title="Markets" subtitle="configurable, not hard-coded" bodyClassName="p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <Input className="col-span-2" placeholder="Market name, e.g. Player shots on target" value={mk.name} onChange={(e) => setMk({ ...mk, name: e.target.value })} />
          <Select value={mk.category} onChange={(e) => setMk({ ...mk, category: e.target.value })}>{["result", "handicap", "totals", "props", "specials", "other"].map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={mk.sport_id} onChange={(e) => setMk({ ...mk, sport_id: e.target.value })}><option value="">All sports</option>{app.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select value={mk.settlement} onChange={(e) => setMk({ ...mk, settlement: e.target.value })}><option value="binary">Win/lose/void</option><option value="quarter">Quarter lines (half results)</option><option value="multi">Multi-outcome</option></Select>
          <label className="flex items-center gap-1 text-[11px]"><Checkbox checked={mk.has_line} onChange={(e) => setMk({ ...mk, has_line: e.target.checked })} /> Has a line</label>
          <Input className="col-span-2" placeholder="Outcomes (comma separated, Home/Away use team names)" value={mk.outcomes} onChange={(e) => setMk({ ...mk, outcomes: e.target.value })} />
        </div>
        <Button size="sm" className="mt-1.5" disabled={!mk.name} onClick={async () => { done(await addMarketType({ ...mk, sport_id: mk.sport_id || null, outcomes: mk.outcomes.split(",").map((x) => x.trim()).filter(Boolean) }), "Market added"); setMk({ ...mk, name: "", outcomes: "" }); }}>Add market</Button>
        <div className="mt-2 max-h-72 overflow-auto text-xs">{app.marketTypes.map((m) => (
          <div key={m.id} className="flex items-center justify-between border-b border-line/50 py-0.5"><span>{m.name} <span className="text-dim">· {m.category}{m.has_line ? " · line" : ""}{m.sport_id ? ` · ${app.sports.find((s) => s.id === m.sport_id)?.name}` : ""}</span></span>
            {m.owner_id && <button className="text-dim hover:text-down" onClick={() => del("market_types", m.id)}>remove</button>}</div>
        ))}</div>
      </Panel>
    </div>
  );
}

function DataSources({ providers, connections, logs, caps }: { providers: Tables<"odds_providers">[]; connections: Tables<"api_connections">[]; logs: Tables<"api_request_logs">[]; caps: Caps }) {
  return (
    <div className="flex flex-col gap-3">
      {(!caps.encryption || !caps.serviceRole) && <Notice level="error">Server is missing {[!caps.encryption && "API_KEY_ENCRYPTION_KEY", !caps.serviceRole && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(" and ")}: API keys cannot be stored or used until the administrator sets them.</Notice>}
      <Notice>API keys are encrypted with AES-256-GCM on the server and are never sent back to the browser. Odds fetched with your key are stored privately for your account. Automated refresh runs on the server schedule within each provider&apos;s minimum interval.</Notice>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {providers.map((p) => <ProviderCard key={p.id} p={p} conns={connections.filter((c) => c.provider_id === p.id)} />)}
      </div>
      <Panel title="Request log" subtitle="latest 60 provider requests (secrets redacted)">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs"><thead className="sticky top-0 bg-panel-2"><tr>{["Time", "Provider", "Endpoint", "Status", "ms", "Cache", "Cost", "Error"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l.id} className="border-b border-line/60"><td className="num h-7 px-2 text-muted">{fmtDateTime(l.at)}</td><td className="px-2">{l.provider_id}</td><td className="num px-2">{l.endpoint}</td>
                <td className={cn("num px-2", l.status && l.status < 300 ? "text-up" : "text-down")}>{l.status ?? "ERR"}</td><td className="num px-2">{l.duration_ms}</td><td className="px-2">{l.cache_hit ? "hit" : ""}</td><td className="num px-2">{l.cost_units ?? ""}</td><td className="max-w-[300px] truncate px-2 text-down">{l.error}</td></tr>
            ))}{!logs.length && <tr><td colSpan={8} className="py-6 text-center text-dim">No requests yet</td></tr>}</tbody></table>
        </div>
      </Panel>
    </div>
  );
}

function ProviderCard({ p, conns }: { p: Tables<"odds_providers">; conns: Tables<"api_connections">[] }) {
  const router = useRouter();
  const c = conns[0];
  const cfg = (c?.config ?? {}) as { regions?: string; markets?: string; sports?: string[]; refresh_seconds?: number; season?: number };
  const [key, setKey] = React.useState("");
  const [f, setF] = React.useState({ regions: cfg.regions ?? "eu,uk", markets: cfg.markets ?? "h2h,spreads,totals", sports: (cfg.sports ?? []).join(","), refresh: String(cfg.refresh_seconds ?? Math.max(600, p.min_refresh_seconds)), season: cfg.season ? String(cfg.season) : "" });
  const [available, setAvailable] = React.useState<{ key: string; title: string; group: string }[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const go = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, ok: (d: T) => string) => {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) toast.error(r.error); else { toast.success(ok(r.data)); router.refresh(); }
    return r;
  };
  const submit = () => go(() => saveConnection({ id: c?.id, provider_id: p.id, api_key: key || undefined, config: {
    regions: p.id === "the_odds_api" ? f.regions : undefined, markets: p.id === "the_odds_api" ? f.markets : undefined, sports: f.sports.split(",").map((x) => x.trim()).filter(Boolean),
    refresh_seconds: Number(f.refresh), season: f.season ? Number(f.season) : undefined } }), () => { setKey(""); return "Connection saved"; });
  return (
    <Panel title={p.name} subtitle={p.kind.replace(/_/g, " ")} actions={c ? <Badge tone={c.status === "ok" ? "up" : c.status === "untested" ? "neutral" : "down"}>{c.status}</Badge> : <Badge>{p.implemented ? "not connected" : "not available"}</Badge>} bodyClassName="flex flex-col gap-2 p-3">
      <p className="text-[11px] text-muted">{p.notes}</p>
      <KV k="Min refresh interval" v={`${p.min_refresh_seconds}s`} /><KV k="Live odds / history" v={`${p.supports_live ? "yes" : "no"} / ${p.supports_history ? "yes" : "no"}`} />
      {p.docs_url && <a href={p.docs_url} target="_blank" rel="noreferrer" className="text-[11px] text-accent">Provider documentation ↗</a>}
      {!p.implemented ? <Notice>No adapter in this release. The provider abstraction (src/lib/providers) is ready for one.</Notice> : (
        <>
          {c && <div className="text-[11px] text-muted">Key •••• {c.key_last4} · tested {fmtAgo(c.last_tested_at)} · last success {fmtAgo(c.last_success_at)}{c.quota_remaining != null ? ` · ${c.quota_remaining} requests/credits left` : ""}{c.last_error ? <span className="block text-down">{c.last_error}</span> : null}</div>}
          <Label>{c ? "Replace API key" : "API key"}<Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={c ? "leave empty to keep" : "paste key"} /></Label>
          {p.id === "the_odds_api" && <div className="grid grid-cols-2 gap-1.5"><Label>Regions<Input value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} /></Label><Label>Markets<Input value={f.markets} onChange={(e) => setF({ ...f, markets: e.target.value })} /></Label></div>}
          {p.id === "api_football" && <Label>Season<Input value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} placeholder="e.g. 2026" /></Label>}
          <Label>{p.id === "api_football" ? "League IDs (comma separated)" : "Sport keys to poll (comma separated, max 12)"}<Input value={f.sports} onChange={(e) => setF({ ...f, sports: e.target.value })} placeholder={p.id === "api_football" ? "39,140" : "soccer_epl,basketball_nba"} /></Label>
          {available && <div className="max-h-40 overflow-auto rounded border border-line p-1 text-[11px]">{available.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5"><Checkbox checked={f.sports.split(",").map((x) => x.trim()).includes(s.key)} onChange={(e) => {
              const cur = f.sports.split(",").map((x) => x.trim()).filter(Boolean);
              setF({ ...f, sports: (e.target.checked ? [...cur, s.key] : cur.filter((x) => x !== s.key)).join(",") });
            }} /><span className="text-dim">{s.group}</span> {s.title} <span className="num text-dim">{s.key}</span></label>
          ))}</div>}
          <Label>Refresh every (seconds, ≥ {p.min_refresh_seconds})<Input inputMode="numeric" value={f.refresh} onChange={(e) => setF({ ...f, refresh: e.target.value })} /></Label>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={submit} disabled={busy || (!c && !key)}>{c ? "Save" : "Connect"}</Button>
            {c && <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => go(() => testConnection(c.id), (d) => `${d.ok ? "OK" : "Failed"}: ${d.message}`)}><PlugZap className="h-3 w-3" /> Test</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const r = await listProviderSports(c.id); if (!r.ok) toast.error(r.error); else setAvailable(r.data); }}>Browse sports</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => go(() => refreshConnection(c.id), (d) => `${d.events} events, ${d.snapshots} snapshots${d.errors.length ? `, ${d.errors.length} errors` : ""}`)}><RefreshCw className="h-3 w-3" /> Fetch now</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm("Delete this connection and its stored key?")) void go(() => deleteConnection(c.id), () => "Connection deleted"); }}><Trash2 className="h-3 w-3" /></Button>
            </>}
          </div>
        </>
      )}
    </Panel>
  );
}

function Demo({ demoBets }: { demoBets: number }) {
  const app = useAppData();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) toast.error(r.error ?? "Failed"); else { toast.success(msg); router.refresh(); }
  };
  return (
    <Panel title="Demo workspace" bodyClassName="flex flex-col gap-3 p-3 text-xs">
      <p className="text-muted">The demo workspace is a separate set of rows (flagged <code>is_demo</code>) with simulated bets, prices and outcomes for fictional teams across football, tennis and basketball: pre-match and live, singles and accumulators, multiple bookmakers, strategies and exchange trades. It never mixes with your live data — every query filters by workspace, and demo rows can only be deleted by the demo reset.</p>
      <KV k="Current workspace" v={app.isDemo ? <Badge tone="demo">DEMO</Badge> : <Badge tone="accent">LIVE</Badge>} />
      <KV k="Demo bets stored" v={demoBets} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => act(() => setMode(app.isDemo ? "live" : "demo"), app.isDemo ? "Live workspace" : "Demo workspace")}><FlaskConical className="h-3.5 w-3.5" /> Switch to {app.isDemo ? "live" : "demo"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { if (confirm("Replace all demo data with a fresh simulated dataset?")) void act(resetDemo, "Demo data reset"); }}>Reset demo data</Button>
        <Button variant="danger" disabled={busy || !demoBets} onClick={() => { if (confirm("Delete all demo data?")) void act(clearDemo, "Demo data cleared"); }}>Delete demo data</Button>
      </div>
    </Panel>
  );
}

function Account({ profile, email, caps }: { profile: Tables<"profiles"> | null; email: string | null; caps: Caps }) {
  const router = useRouter();
  const [name, setName] = React.useState(profile?.display_name ?? "");
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel title="Profile" bodyClassName="flex flex-col gap-2 p-3">
        <KV k="Email" v={email ?? "—"} /><KV k="Role" v={profile?.role ?? "user"} /><KV k="Member since" v={fmtDate(profile?.created_at)} />
        <Label>Display name<Input value={name} onChange={(e) => setName(e.target.value)} /></Label>
        <Button size="sm" className="self-start" onClick={async () => { const r = await updateProfile({ display_name: name }); if (!r.ok) toast.error(r.error); else { toast.success("Saved"); router.refresh(); } }}>Save</Button>
      </Panel>
      <Panel title="Security & data" bodyClassName="p-3 text-xs">
        <KV k="Data isolation" v="Row-level security on every table" />
        <KV k="Financial writes" v="Server-side transactional functions only" />
        <KV k="Audit trail" v="Every bet, transaction, trade and setting change" />
        <KV k="API key encryption" v={caps.encryption ? "AES-256-GCM (configured)" : "NOT CONFIGURED"} />
        <KV k="Email alerts" v={caps.email ? "configured" : "not configured (in-app only)"} />
        <div className="mt-3 flex gap-2">
          <a href="/api/export/backup"><Button size="sm" variant="outline">Download JSON backup</Button></a>
          <form action="/auth/signout" method="post"><Button size="sm" variant="ghost">Sign out</Button></form>
        </div>
      </Panel>
    </div>
  );
}
