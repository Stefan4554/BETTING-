"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, PlugZap, RefreshCw } from "lucide-react";
import type { BoardEvent, BoardMarket } from "@/lib/server/odds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/app/primitives";
import { TimeSeries } from "@/components/charts/charts";
import { useAppData, useNewBet } from "@/components/app/app-data";
import { refreshConnection } from "@/app/actions/connections";
import { marketHistory } from "@/app/actions/search";
import { fmtAgo, fmtDateTime, fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Conn = { id: string; provider: string; label: string; status: string; lastSuccess: string | null; lastError: string | null; quotaRemaining: number | null; enabled: boolean; sports: string[]; refresh: number };

export function OddsMonitor({ events, snapshotCount, isDemo, connections, sportFilter }: { events: BoardEvent[]; snapshotCount: number; isDemo: boolean; connections: Conn[]; sportFilter: string }) {
  const app = useAppData();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [market, setMarket] = React.useState("");
  const [book, setBook] = React.useState("");
  const [arbOnly, setArbOnly] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const filtered = events.filter((e) => !q || `${e.name} ${e.league ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .map((e) => ({ ...e, markets: e.markets.filter((m) => (!market || m.key === market) && (!arbOnly || m.arb?.isArb)) })).filter((e) => e.markets.length);
  const allBooks = [...new Set(events.flatMap((e) => e.markets.flatMap((m) => m.bookmakers)))].sort();
  const marketKeys = [...new Set(events.flatMap((e) => e.markets.map((m) => m.key)))];
  const arbs = events.flatMap((e) => e.markets.filter((m) => m.arb?.isArb)).length;
  const refresh = async (c: Conn) => {
    setBusy(c.id);
    const r = await refreshConnection(c.id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${r.data.events} events · ${r.data.snapshots} new price snapshots${r.data.closing ? ` · ${r.data.closing} closing prices captured` : ""}${r.data.errors.length ? ` · ${r.data.errors.length} errors` : ""}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Odds Monitor" description={`${filtered.length} events · ${snapshotCount.toLocaleString()} stored snapshots (72h) · comparison of stored bookmaker prices`} />
      {isDemo ? <Notice level="warn">DEMO: these prices are simulated for fictional events. They are not real odds.</Notice> : (
        connections.length === 0 ? (
          <Panel><EmptyState icon="plug" title="No odds provider connected" action={<Link href="/settings?tab=data"><Button>Connect a data provider</Button></Link>}>
            Real-time and historical odds require a licensed data provider (e.g. The Odds API, API-Football). Add your API key under Settings → Data sources. Until then this page stays empty — no prices are invented. You can still enter odds manually on every bet.
          </EmptyState></Panel>
        ) : (
          <div className="flex flex-wrap gap-2">{connections.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-[3px] border border-line bg-panel px-2.5 py-1.5 text-xs">
              <PlugZap className={cn("h-3.5 w-3.5", c.status === "ok" ? "text-up" : c.status === "untested" ? "text-muted" : "text-down")} />
              <b>{c.provider}</b><span className="text-muted">{c.label}</span>
              <span className="text-dim">updated {fmtAgo(c.lastSuccess)} · every {Math.round(c.refresh / 60)}m{c.quotaRemaining != null ? ` · ${c.quotaRemaining} credits left` : ""}</span>
              {c.lastError && <span className="max-w-[260px] truncate text-down" title={c.lastError}>{c.lastError}</span>}
              <Button size="sm" variant="outline" disabled={busy === c.id || !c.enabled} onClick={() => refresh(c)}><RefreshCw className={cn("h-3 w-3", busy === c.id && "animate-spin")} /> Refresh</Button>
            </div>
          ))}</div>
        )
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input className="w-56" placeholder="Search event or league" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-40" value={sportFilter} onChange={(e) => router.push(e.target.value ? `/odds?sport=${e.target.value}` : "/odds")} aria-label="Sport"><option value="">All sports</option>{app.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select className="w-36" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market"><option value="">All markets</option>{marketKeys.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
        <Select className="w-40" value={book} onChange={(e) => setBook(e.target.value)} aria-label="Bookmaker"><option value="">All bookmakers</option>{allBooks.map((b) => <option key={b}>{b}</option>)}</Select>
        <Button variant={arbOnly ? "default" : "outline"} onClick={() => setArbOnly((x) => !x)}>Arbitrage only ({arbs})</Button>
      </div>
      {filtered.length === 0 && (connections.length > 0 || isDemo) && <Panel><EmptyState title="No stored prices for this filter">Refresh a connection or widen the filters. Only events starting within the last 6 hours or later are shown.</EmptyState></Panel>}
      {filtered.map((e) => (
        <Panel key={e.id} title={e.name} subtitle={`${e.sport}${e.league ? " · " + e.league : ""} · ${fmtDateTime(e.start)}`} actions={<>{e.isLive && <Badge tone="up"><span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-up" /> live</Badge>}<Badge>{e.provider === "demo" ? "SIMULATED" : e.provider}</Badge></>}>
          <div className="flex flex-col divide-y divide-line">
            {e.markets.map((m) => <MarketTable key={m.id} e={e} m={m} bookFilter={book} />)}
          </div>
        </Panel>
      ))}
      <p className="text-[11px] text-dim">Best price per selection is highlighted. ▲/▼ show movement from the first stored price (drift / shortening). Consensus is the average no-vig probability across bookmakers with a complete market. Arbitrage figures are theoretical until executable prices, limits and settlement rules are verified.</p>
    </div>
  );
}

function MarketTable({ e, m, bookFilter }: { e: BoardEvent; m: BoardMarket; bookFilter: string }) {
  const newBet = useNewBet();
  const app = useAppData();
  const [hist, setHist] = React.useState<{ selection: string; data: Record<string, unknown>[]; books: string[] } | null>(null);
  const books = bookFilter ? m.bookmakers.filter((b) => b === bookFilter) : m.bookmakers;
  const loadHistory = async (selection: string) => {
    const r = await marketHistory(m.id);
    if (!r.ok) return toast.error(r.error);
    const pts = r.data.filter((p) => p.selection === selection);
    const bks = [...new Set(pts.map((p) => p.bookmaker))].slice(0, 6);
    const rows = new Map<string, Record<string, unknown>>();
    for (const p of pts) if (bks.includes(p.bookmaker)) rows.set(p.at, { ...(rows.get(p.at) ?? { at: p.at }), [p.bookmaker]: p.odds });
    setHist({ selection, data: [...rows.values()], books: bks });
  };
  const bet = (sel: BoardMarket["selections"][number], q?: { bookmakerId: string; odds: number; line: number | null }) => {
    const quote = q ?? sel.best;
    const mt = app.marketTypes.find((x) => (m.key === "h2h" ? (e.sport.startsWith("Football") ? x.key === "match_winner" : x.key === "moneyline") : m.key === "totals" ? x.key === "totals" : m.key === "spreads" ? x.key === "spread" : false));
    newBet.open({ event_id: e.id, market_id: m.id, event_name: e.name, home: e.home, away: e.away, event_start: e.start, sport_id: e.sportId, league_id: e.leagueId,
      is_live: e.isLive, market: m.name, market_type_id: mt?.id, selection: sel.name, line: quote?.line ?? m.line, odds: quote?.odds, bookmaker_id: quote?.bookmakerId, opening_odds: sel.quotes.find((x) => x.bookmakerId === quote?.bookmakerId)?.opening });
  };
  return (
    <div className="p-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <b>{m.name}{m.line != null ? ` ${m.line}` : ""}</b><span className="text-dim">updated {fmtAgo(m.lastUpdated)}</span>
        {m.arb?.isArb && (
          <Popover>
            <PopoverTrigger asChild><button><Badge tone="up">Theoretical arb +{fmtPct(m.arb.margin, 2)}</Badge></button></PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="label-xs mb-1">Stake allocation for 100 total</div>
              {m.arb.legs.map((l) => <div key={l.selection} className="flex justify-between text-xs"><span>{l.selection} @ {l.odds} ({l.bookmaker})</span><span className="num">{fmtMoney(l.stake, app.displayCurrency)}</span></div>)}
              <div className="mt-1 text-xs">Guaranteed return {fmtMoney(m.arb.guaranteedReturn, app.displayCurrency)} · profit {fmtMoney(m.arb.guaranteedProfit, app.displayCurrency, true)}</div>
              <p className="mt-2 text-[11px] text-warn">Theoretical: verify prices are still available, stake limits, commission, currency and that both books settle the market identically (e.g. retirement rules, extra time).</p>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left">
            <th className="label-xs h-6 px-2">Selection</th><th className="label-xs px-2">Best</th><th className="label-xs px-2">Implied</th><th className="label-xs px-2">No-vig</th><th className="label-xs px-2">Move</th>
            {books.map((b) => <th key={b} className="label-xs whitespace-nowrap px-2">{b}<div className="text-[9px] normal-case tracking-normal text-dim">{m.overround[b] != null ? `margin ${fmtPct(m.overround[b], 1)}` : ""}</div></th>)}
            <th />
          </tr></thead>
          <tbody>{m.selections.map((s) => (
            <tr key={s.name} className="border-t border-line/60">
              <td className="h-7 whitespace-nowrap px-2 font-medium">{s.name}</td>
              <td className="num whitespace-nowrap px-2 text-accent">{s.best ? `${s.best.odds.toFixed(2)}` : "—"}<span className="ml-1 text-[10px] text-dim">{s.best?.bookmaker}</span></td>
              <td className="num px-2">{s.best ? fmtPct(1 / s.best.odds) : "—"}</td>
              <td className="num px-2">{fmtPct(s.consensusProb)}</td>
              <td className="px-2">{s.move ? <span className={cn("num", s.move.direction === "shortening" ? "text-up" : s.move.direction === "drifting" ? "text-down" : "text-muted")} title={`implied ${(s.move.probShift * 100).toFixed(1)}pp`}>{s.move.direction === "shortening" ? "▼" : s.move.direction === "drifting" ? "▲" : "·"} {fmtPct(Math.abs(s.move.changePct), 1)}{s.move.significant && " !"}</span> : "—"}</td>
              {books.map((b) => {
                const quote = s.quotes.find((x) => x.bookmaker === b);
                const best = quote && s.best && quote.odds === s.best.odds;
                return (
                  <td key={b} className={cn("num px-2", best && "bg-accent-soft/40 font-semibold", quote?.suspended && "text-dim line-through")} title={quote ? `opened ${quote.opening.toFixed(2)} · ${fmtAgo(quote.updatedAt)} · ${quote.provider}` : "not offered"}>
                    {quote ? <button className="hover:underline" onClick={() => bet(s, quote)} disabled={quote.suspended}>{quote.odds.toFixed(2)}{quote.odds > quote.opening ? <span className="text-down">↑</span> : quote.odds < quote.opening ? <span className="text-up">↓</span> : ""}</button> : <span className="text-dim">—</span>}
                  </td>
                );
              })}
              <td className="whitespace-nowrap px-2"><Button size="sm" variant="ghost" onClick={() => loadHistory(s.name)} aria-label="Price history"><History className="h-3 w-3" /></Button><Button size="sm" variant="outline" onClick={() => bet(s)} disabled={!s.best}>Bet</Button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {hist && (
        <div className="mt-2 rounded-[3px] border border-line">
          <div className="flex items-center justify-between px-2 py-1 text-xs"><span>Price history · {hist.selection}</span><button className="text-muted" onClick={() => setHist(null)}>close</button></div>
          <TimeSeries data={hist.data} series={hist.books.map((b) => ({ key: b, name: b }))} format="odds" zeroLine={false} height={180} />
        </div>
      )}
    </div>
  );
}
