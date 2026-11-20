"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell, ChevronsLeft, ChevronsRight, FlaskConical, LogOut, Menu as MenuIcon, Plus, Search, Settings, User, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { NewBetContext, useAppData } from "./app-data";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BetFormDialog } from "@/components/bets/bet-form";
import { markAlertsRead, setMode, setRange, updateSettings } from "@/app/actions/settings";
import { recentAlerts, searchAll } from "@/app/actions/search";
import { CURRENCIES, fmtAgo, fmtDate, STATUS_LABEL } from "@/lib/format";

export function Shell({ children }: { children: React.ReactNode }) {
  const data = useAppData();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [betOpen, setBetOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<Record<string, unknown> | undefined>();
  const pathname = usePathname();

  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem("bep_sidebar") === "1"); } catch { /* storage unavailable */ }
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) { e.preventDefault(); setPrefill(undefined); setBetOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("bep_sidebar", c ? "0" : "1"); } catch { /* */ } return !c; });
  const openBet = React.useCallback((p?: Record<string, unknown>) => { setPrefill(p); setBetOpen(true); }, []);

  return (
    <NewBetContext.Provider value={{ open: openBet }}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-panel transition-[width,transform] md:static md:translate-x-0",
          collapsed ? "md:w-[52px]" : "md:w-[208px]", "w-[220px]", mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}>
          <div className="flex h-11 items-center gap-2 border-b border-line px-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] bg-accent text-[11px] font-black text-white">BE</div>
            {(!collapsed || mobileOpen) && (
              <div className="leading-3"><div className="text-[12px] font-bold tracking-[0.16em]">BETTING EDGE</div><div className="text-[9px] tracking-[0.3em] text-muted">PRO TERMINAL</div></div>
            )}
            <button className="ml-auto text-muted md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} title={n.label}
                  className={cn("mx-1.5 flex h-8 items-center gap-2.5 rounded-[3px] px-2.5 text-[12.5px] text-muted hover:bg-raised hover:text-fg",
                    active && "bg-accent-soft/60 text-fg")}>
                  <Icon className={cn("h-4 w-4 shrink-0", active && "text-accent")} />
                  {(!collapsed || mobileOpen) && <span className="truncate">{n.label}</span>}
                </Link>
              );
            })}
          </nav>
          <button onClick={toggle} className="hidden h-9 items-center gap-2 border-t border-line px-4 text-[11px] text-muted hover:text-fg md:flex">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setMobileOpen(true)} onNewBet={() => openBet()} />
          {data.isDemo && (
            <div className="flex items-center gap-2 border-b border-demo/40 bg-demo/10 px-4 py-1 text-[11.5px] text-demo">
              <FlaskConical className="h-3.5 w-3.5" />
              <b>DEMO WORKSPACE</b> — simulated bets, prices and outcomes with fictional teams. Nothing here is your real data.
              <Link href="/settings?tab=demo" className="ml-auto underline">Manage demo</Link>
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">{children}</main>
        </div>
      </div>
      <BetFormDialog open={betOpen} onOpenChange={setBetOpen} prefill={prefill} />
    </NewBetContext.Provider>
  );
}

const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["ytd", "Year to date"], ["all", "All time"]] as const;

function TopBar({ onMenu, onNewBet }: { onMenu: () => void; onNewBet: () => void }) {
  const data = useAppData();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [from, setFrom] = React.useState(data.range.from ?? "");
  const [to, setTo] = React.useState(data.range.to ?? "");

  const applyRange = (r: { preset: string; from?: string; to?: string }) => start(async () => {
    const res = await setRange(r as never);
    if (!res.ok) toast.error(res.error); else router.refresh();
  });
  const switchMode = (m: "live" | "demo") => start(async () => {
    const t = toast.loading(m === "demo" ? "Opening demo workspace…" : "Switching to live data…");
    const res = await setMode(m);
    toast.dismiss(t);
    if (!res.ok) toast.error(res.error); else { toast.success(m === "demo" ? "Demo workspace" : "Live workspace"); router.refresh(); }
  });

  return (
    <header className="app-topbar flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 md:px-3">
      <button className="text-muted md:hidden" onClick={onMenu} aria-label="Open menu"><MenuIcon className="h-5 w-5" /></button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="md" className="num" disabled={pending}>{data.rangeLabel}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="label-xs mb-1.5">Global date filter</div>
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.map(([k, l]) => (
                <Button key={k} size="sm" variant={data.range.preset === k ? "default" : "outline"} onClick={() => applyRange({ preset: k })}>{l}</Button>
              ))}
            </div>
            <div className="label-xs mb-1 mt-3">Custom range</div>
            <div className="flex gap-1">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </div>
            <Button size="sm" className="mt-1.5 w-full" disabled={!from || !to} onClick={() => applyRange({ preset: "custom", from, to })}>Apply</Button>
          </PopoverContent>
        </Popover>
        <Select aria-label="Display currency" className="hidden w-[72px] sm:block" value={data.displayCurrency} disabled={pending}
          onChange={(e) => start(async () => { const r = await updateSettings({ display_currency: e.target.value }); if (!r.ok) toast.error(r.error); router.refresh(); })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div className="hidden overflow-hidden rounded-[3px] border border-line-strong text-[11px] sm:flex" role="group" aria-label="Workspace">
          <button className={cn("px-2 py-1", !data.isDemo ? "bg-accent text-white" : "text-muted hover:text-fg")} onClick={() => data.isDemo && switchMode("live")} disabled={pending}>LIVE</button>
          <button className={cn("px-2 py-1", data.isDemo ? "bg-demo text-white" : "text-muted hover:text-fg")} onClick={() => !data.isDemo && switchMode("demo")} disabled={pending}>DEMO</button>
        </div>
        <Button size="md" onClick={onNewBet} title="New bet (N)"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">New bet</span></Button>
        <Notifications />
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Account"><User className="h-4 w-4" /></Button></MenuTrigger>
          <MenuContent>
            <MenuLabel>{data.userEmail ?? "Signed in"}</MenuLabel>
            <MenuItem onSelect={() => router.push("/settings")}><Settings className="h-3.5 w-3.5" /> Settings</MenuItem>
            <MenuItem className="sm:hidden" onSelect={() => switchMode(data.isDemo ? "live" : "demo")}><FlaskConical className="h-3.5 w-3.5" /> Switch to {data.isDemo ? "live" : "demo"}</MenuItem>
            <MenuSeparator />
            <form action="/auth/signout" method="post"><button className="flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left hover:bg-raised"><LogOut className="h-3.5 w-3.5" /> Sign out</button></form>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}

type SearchResult = Awaited<ReturnType<typeof searchAll>>;

function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [res, setRes] = React.useState<SearchResult | null>(null);
  const router = useRouter();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const t = setTimeout(async () => setRes(await searchAll(q)), 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  const pages = NAV.filter((n) => q && n.label.toLowerCase().includes(q.toLowerCase()));
  const data = res?.ok ? res.data : null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[3px] border border-line-strong bg-panel-2 px-2 text-xs text-dim hover:text-muted md:max-w-xs">
        <Search className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Search bets, events, strategies…</span><kbd className="ml-auto hidden text-[10px] md:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Search" description="Bets (event, selection, market, notes or #ref), strategies, trades and pages">
          <Input autoFocus placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 flex flex-col gap-0.5 text-xs">
            {pages.map((p) => <button key={p.href} className="rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => go(p.href)}>Page · {p.label}</button>)}
            {data?.bets.map((b) => (
              <button key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => go(`/bets?bet=${b.id}`)}>
                <span className="num text-dim">#{b.ref}</span><span className="truncate">{b.event_name}</span><span className="truncate text-muted">{b.selection}</span>
                <span className="ml-auto shrink-0 text-dim">{STATUS_LABEL[b.status]} · {fmtDate(b.placed_at)}</span>
              </button>
            ))}
            {data?.strategies.map((s) => <button key={s.id} className="rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => go(`/strategies?id=${s.id}`)}>Strategy · {s.name}</button>)}
            {data?.trades.map((t) => <button key={t.id} className="rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => go(`/live`)}>Trade · {t.event_name} — {t.selection} ({t.status})</button>)}
            {q && data && !data.bets.length && !data.strategies.length && !data.trades.length && !pages.length && <p className="px-2 py-3 text-dim">No results</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type AlertRow = { id: string; title: string; body: string | null; severity: string; created_at: string; read_at: string | null };

function Notifications() {
  const data = useAppData();
  const router = useRouter();
  const [items, setItems] = React.useState<AlertRow[] | null>(null);
  const load = async () => { const r = await recentAlerts(); if (r.ok) setItems(r.data as AlertRow[]); };
  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${data.unreadAlerts} unread)`} className="relative">
          <Bell className="h-4 w-4" />
          {data.unreadAlerts > 0 && <span className="num absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-down px-0.5 text-[9px] text-white">{Math.min(99, data.unreadAlerts)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="label-xs">Notifications</span>
          <div className="flex gap-2 text-[11px]">
            <button className="text-accent" onClick={async () => { await markAlertsRead(); await load(); router.refresh(); }}>Mark all read</button>
            <Link href="/alerts" className="text-muted hover:text-fg">View all</Link>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null && <p className="p-3 text-xs text-dim">Loading…</p>}
          {items?.length === 0 && <p className="p-3 text-xs text-dim">No notifications</p>}
          {items?.map((a) => (
            <div key={a.id} className={cn("border-b border-line/60 px-3 py-2 text-xs", !a.read_at && "bg-accent-soft/20")}>
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", a.severity === "critical" ? "bg-down" : a.severity === "warning" ? "bg-warn" : "bg-accent")} />
                <span className="font-medium">{a.title}</span><span className="ml-auto text-[10.5px] text-dim">{fmtAgo(a.created_at)}</span>
              </div>
              {a.body && <p className="mt-0.5 text-muted">{a.body}</p>}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
