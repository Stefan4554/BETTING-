/**
 * Browser-only build of EDGE INTELLIGENCE (demo mode). The real server pages and
 * API route handlers are bundled as-is: pages are awaited in the browser, and
 * `fetch("/api/...")` is answered by the route handlers in-process. No network
 * requests leave the page, no keys exist, and all data is the fictional demo set.
 */
import { createRoot } from "react-dom/client";
import { Component, useEffect, useState, type ReactNode } from "react";
import "../src/app/globals.css";
import { Providers } from "@/components/providers";
import TerminalLayout from "@/app/(terminal)/layout";
import { NotFoundError } from "./shims/next-navigation";
import { useLocation } from "./shims/router";
import { NextRequest } from "./shims/next-server";

import Overview from "@/app/(terminal)/page";
import Live from "@/app/(terminal)/live/page";
import Upcoming from "@/app/(terminal)/upcoming/page";
import Lines from "@/app/(terminal)/lines/page";
import Odds from "@/app/(terminal)/odds/page";
import Movement from "@/app/(terminal)/movement/page";
import Value from "@/app/(terminal)/value/page";
import Predictions from "@/app/(terminal)/predictions/page";
import Analytics from "@/app/(terminal)/analytics/page";
import Players from "@/app/(terminal)/players/page";
import PlayerPage from "@/app/(terminal)/players/[id]/page";
import Tournaments from "@/app/(terminal)/tournaments/page";
import MatchPage from "@/app/(terminal)/matches/[id]/page";
import Tracker from "@/app/(terminal)/tracker/page";
import Bankroll from "@/app/(terminal)/bankroll/page";
import Performance from "@/app/(terminal)/performance/page";
import Alerts from "@/app/(terminal)/alerts/page";
import ApiManagement from "@/app/(terminal)/api-management/page";
import Settings from "@/app/(terminal)/settings/page";

import * as apiLive from "@/app/api/live/route";
import * as apiSearch from "@/app/api/search/route";
import * as apiValue from "@/app/api/value/route";
import * as apiMarketState from "@/app/api/market-state/route";
import * as apiBets from "@/app/api/bets/route";
import * as apiBetsExport from "@/app/api/bets/export/route";
import * as apiAlerts from "@/app/api/alerts/route";
import * as apiProviders from "@/app/api/providers/route";
import * as apiProvidersTest from "@/app/api/providers/test/route";
import * as apiMatches from "@/app/api/matches/route";
import * as apiOdds from "@/app/api/odds/[matchId]/route";

// ---------- in-browser API ----------
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>;
const API: [RegExp, RouteModule, string[]][] = [
  [/^\/api\/live$/, apiLive as unknown as RouteModule, []],
  [/^\/api\/search$/, apiSearch as unknown as RouteModule, []],
  [/^\/api\/value$/, apiValue as unknown as RouteModule, []],
  [/^\/api\/market-state$/, apiMarketState as unknown as RouteModule, []],
  [/^\/api\/bets\/export$/, apiBetsExport as unknown as RouteModule, []],
  [/^\/api\/bets$/, apiBets as unknown as RouteModule, []],
  [/^\/api\/alerts$/, apiAlerts as unknown as RouteModule, []],
  [/^\/api\/providers\/test$/, apiProvidersTest as unknown as RouteModule, []],
  [/^\/api\/providers$/, apiProviders as unknown as RouteModule, []],
  [/^\/api\/matches$/, apiMatches as unknown as RouteModule, []],
  [/^\/api\/odds\/([^/]+)$/, apiOdds as unknown as RouteModule, ["matchId"]],
];
const ORIGIN = "https://edge-intelligence.demo";
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!raw.startsWith("/api/")) return realFetch(input, init);
  const url = new URL(raw, ORIGIN);
  for (const [re, mod, names] of API) {
    const m = url.pathname.match(re);
    if (!m) continue;
    const method = (init?.method ?? "GET").toUpperCase() as keyof RouteModule;
    const h = mod[method];
    if (!h) return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? "")]));
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return h(new NextRequest(url, { ...init, signal: undefined }), { params: Promise.resolve(params) });
  }
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
};

// ---------- file export through the viewer's save dialog ----------
type Downloads = { save(o: { filename: string; data: Blob }): Promise<unknown> };
const claudeRt = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
const downloadsP: Promise<Downloads | null> = claudeRt ? (claudeRt.use("downloads") as Promise<Downloads | null>).catch(() => null) : Promise.resolve(null);
(globalThis as { __edgeSaveFile?: unknown }).__edgeSaveFile = (filename: string, text: string, type: string) => {
  void downloadsP.then(async (d) => {
    if (!d) return toast("Export isn't available in this view.");
    try { await d.save({ filename, data: new Blob([text], { type }) }); }
    catch (e) { const code = (e as { code?: string })?.code; if (code !== "declined") toast("Export failed. Try again in a moment."); }
  });
};
function toast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className = "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border border-line-strong bg-raised px-3 py-2 text-xs text-fg shadow";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- pages ----------
type Page = (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<ReactNode> | ReactNode;
const PAGES: [RegExp, Page, string[], string][] = [
  [/^\/$/, Overview as unknown as Page, [], "Overview"],
  [/^\/live$/, Live as unknown as Page, [], "Live matches"],
  [/^\/upcoming$/, Upcoming as unknown as Page, [], "Upcoming"],
  [/^\/lines$/, Lines as unknown as Page, [], "Lines board"],
  [/^\/odds$/, Odds as unknown as Page, [], "Odds comparison"],
  [/^\/movement$/, Movement as unknown as Page, [], "Odds movement"],
  [/^\/value$/, Value as unknown as Page, [], "Value bets"],
  [/^\/predictions$/, Predictions as unknown as Page, [], "Predictions"],
  [/^\/analytics$/, Analytics as unknown as Page, [], "Tennis analytics"],
  [/^\/players$/, Players as unknown as Page, [], "Players"],
  [/^\/players\/([^/]+)$/, PlayerPage as unknown as Page, ["id"], "Player"],
  [/^\/tournaments$/, Tournaments as unknown as Page, [], "Tournaments"],
  [/^\/matches\/([^/]+)$/, MatchPage as unknown as Page, ["id"], "Match"],
  [/^\/tracker$/, Tracker as unknown as Page, [], "Betting tracker"],
  [/^\/bankroll$/, Bankroll as unknown as Page, [], "Bankroll"],
  [/^\/performance$/, Performance as unknown as Page, [], "Performance"],
  [/^\/alerts$/, Alerts as unknown as Page, [], "Alerts"],
  [/^\/api-management$/, ApiManagement as unknown as Page, [], "API management"],
  [/^\/settings$/, Settings as unknown as Page, [], "Settings"],
];

function NotFound() {
  return (
    <div className="rounded border border-line bg-panel p-6 text-center">
      <div className="text-sm font-semibold">Not found</div>
      <p className="mt-1 text-xs text-muted">That page or record does not exist in the demo data set.</p>
      <a href="#overview" className="mt-3 inline-block text-xs text-accent hover:underline">Back to overview</a>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) return <div className="rounded border border-down/40 bg-down-soft p-4 text-xs">Something went wrong rendering this page: {this.state.error.message}</div>;
    return this.props.children;
  }
}

function useResolved(key: string, make: () => Promise<ReactNode> | ReactNode) {
  const [state, setState] = useState<{ key: string; node: ReactNode } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(make)
      .then(
        (node) => live && setState({ key, node }),
        (e) => live && setState({ key, node: e instanceof NotFoundError ? <NotFound /> : <div className="rounded border border-down/40 bg-down-soft p-4 text-xs">Could not load this page: {String(e?.message ?? e)}</div> }),
      );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function App() {
  const loc = useLocation();
  const key = `${loc.path}?${loc.query.toString()}#${loc.version}`;
  const hit = PAGES.map(([re, page, names, title]) => ({ m: loc.path.match(re), page, names, title })).find((x) => x.m);
  useEffect(() => { document.title = `${hit?.title ?? "Not found"} · Edge Intelligence`; }, [hit?.title]);

  const view = useResolved(key, async () => {
    let node: ReactNode;
    if (!hit) node = <NotFound />;
    else {
      const params = Object.fromEntries(hit.names.map((n, i) => [n, hit.m![i + 1] ?? ""]));
      try {
        node = await hit.page({ params: Promise.resolve(params), searchParams: Promise.resolve(Object.fromEntries(loc.query)) });
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
        node = <NotFound />;
      }
    }
    return TerminalLayout({ children: <Boundary resetKey={key}>{node}</Boundary> });
  });
  return view?.node ?? <Loading />;
}

function Loading() {
  return <div className="p-6 text-center text-xs text-muted">Loading…</div>;
}

if (!window.location.hash) history.replaceState(null, "", "#overview");
createRoot(document.getElementById("root")!).render(
  <Providers>
    <App />
  </Providers>,
);
