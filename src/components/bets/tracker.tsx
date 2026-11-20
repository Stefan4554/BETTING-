"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type ColumnDef, type RowSelectionState, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Columns3, Copy, Download, Eye, FileUp, Filter, MoreHorizontal, Pencil, RotateCcw, Save, Scissors, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Money, PageHeader, Panel, StatusBadge } from "@/components/app/primitives";
import { useAppData, useNewBet } from "@/components/app/app-data";
import { BetFormDialog } from "./bet-form";
import { SettleDialog } from "./settle-dialog";
import { ImportDialog } from "./import-dialog";
import { BetDetail } from "./bet-detail";
import { exportBets } from "./export";
import { bulkSettle, bulkUpdate, deleteBets, deleteView, duplicateBet, reopenBet, saveView } from "@/app/actions/bets";
import { clv as clvFn, type ClvConvention } from "@/lib/finance/clv";
import { formatOdds } from "@/lib/finance/odds";
import { fmtDateTime, fmtPct, fmtPp, MISSING, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BetView {
  id: string; ref: number; placed_at: string; settled_at: string | null; status: string; kind: string; side: "back" | "lay";
  sport_id: string; sport: string; league_id: string | null; league: string | null; event_name: string; home: string | null; away: string | null;
  event_start: string | null; is_live: boolean; market_type_id: string | null; market: string; market_category: string | null; selection: string; line: number | null;
  bookmaker_id: string | null; bookmaker: string | null; bankroll_id: string; bankroll: string;
  odds: number; stake: number; currency: string; fx_rate: number; commission: number; liability: number; potential_payout: number;
  actual_payout: number | null; profit: number | null; cashout_amount: number; cashed_out_stake: number;
  est_probability: number | null; opening_odds: number | null; closing_odds: number | null; closing_source: string | null;
  strategy_id: string | null; strategy: string | null; confidence: number | null; units: number | null; tags: string[]; notes: string | null; correlation_group: string | null;
  legs: { leg_no: number; event_name: string; market: string; selection: string; line: number | null; odds: number; status: string }[];
}

interface Filters {
  q: string; status: string; sport: string; bookmaker: string; strategy: string; mode: string; side: string; kind: string;
  from: string; to: string; minOdds: string; maxOdds: string; tag: string; bankroll: string;
}
const EMPTY: Filters = { q: "", status: "", sport: "", bookmaker: "", strategy: "", mode: "", side: "", kind: "", from: "", to: "", minOdds: "", maxOdds: "", tag: "", bankroll: "" };

const DEFAULT_HIDDEN: VisibilityState = { league: false, line: false, commission: false, est_probability: false, edge: false, opening_odds: false, closing_odds: false, confidence: false, units: false, tags: false, bankroll: false, settled_at: false, payout: false, correlation_group: false };

export function BetTracker({ bets, views, convention, focusBet, openImport, truncated }: {
  bets: BetView[]; views: { id: string; name: string; config: Record<string, unknown> }[]; convention: ClvConvention; focusBet?: string; openImport?: boolean; truncated?: boolean;
}) {
  const app = useAppData();
  const router = useRouter();
  const newBet = useNewBet();
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = React.useState(false);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "placed_at", desc: true }]);
  const [visibility, setVisibility] = React.useState<VisibilityState>(DEFAULT_HIDDEN);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [editing, setEditing] = React.useState<BetView | null>(null);
  const [settling, setSettling] = React.useState<BetView | null>(null);
  const [detail, setDetail] = React.useState<BetView | null>(() => bets.find((b) => b.id === focusBet) ?? null);
  const [importOpen, setImportOpen] = React.useState(Boolean(openImport));
  const [bulkEdit, setBulkEdit] = React.useState(false);
  const [busy, start] = React.useTransition();
  const ccyOf = (b: BetView) => b.currency;

  React.useEffect(() => {
    try { const v = localStorage.getItem("bep_bet_columns"); if (v) setVisibility(JSON.parse(v)); } catch { /* */ }
  }, []);
  React.useEffect(() => { try { localStorage.setItem("bep_bet_columns", JSON.stringify(visibility)); } catch { /* */ } }, [visibility]);

  const filtered = React.useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const from = filters.from ? Date.parse(filters.from) : null;
    const to = filters.to ? Date.parse(filters.to) + 86_400_000 : null;
    return bets.filter((b) => {
      if (q && !`#${b.ref} ${b.event_name} ${b.selection} ${b.market} ${b.notes ?? ""} ${b.tags.join(" ")} ${b.bookmaker ?? ""}`.toLowerCase().includes(q)) return false;
      if (filters.status === "settled" ? b.status === "pending" : filters.status && b.status !== filters.status) return false;
      if (filters.sport && b.sport_id !== filters.sport) return false;
      if (filters.bookmaker && b.bookmaker_id !== filters.bookmaker) return false;
      if (filters.strategy && (filters.strategy === "none" ? b.strategy_id : b.strategy_id !== filters.strategy)) return false;
      if (filters.bankroll && b.bankroll_id !== filters.bankroll) return false;
      if (filters.mode && (filters.mode === "live") !== b.is_live) return false;
      if (filters.side && b.side !== filters.side) return false;
      if (filters.kind && b.kind !== filters.kind) return false;
      if (from && Date.parse(b.placed_at) < from) return false;
      if (to && Date.parse(b.placed_at) >= to) return false;
      if (filters.minOdds && b.odds < Number(filters.minOdds)) return false;
      if (filters.maxOdds && b.odds > Number(filters.maxOdds)) return false;
      if (filters.tag && !b.tags.some((t) => t.toLowerCase() === filters.tag.toLowerCase())) return false;
      return true;
    });
  }, [bets, filters]);

  const clvOf = (b: BetView) => (b.kind === "single" ? clvFn(b.odds, b.closing_odds, convention, b.side) : null);
  const evOf = (b: BetView) => (b.est_probability != null && b.side === "back" ? b.stake * (b.est_probability * (b.odds - 1) - (1 - b.est_probability)) : null);

  const columns = React.useMemo<ColumnDef<BetView>[]>(() => [
    {
      id: "select", enableSorting: false, enableHiding: false, size: 28,
      header: ({ table }) => <Checkbox aria-label="Select page" checked={table.getIsAllPageRowsSelected()} onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)} />,
      cell: ({ row }) => <Checkbox aria-label={`Select bet ${row.original.ref}`} checked={row.getIsSelected()} onChange={(e) => row.toggleSelected(e.target.checked)} onClick={(e) => e.stopPropagation()} />,
    },
    { accessorKey: "ref", header: "#", cell: (c) => <span className="num text-dim">{c.row.original.ref}</span> },
    { accessorKey: "placed_at", header: "Placed", cell: (c) => <span className="num text-muted">{fmtDateTime(c.row.original.placed_at)}</span> },
    { accessorKey: "settled_at", header: "Settled", cell: (c) => <span className="num text-muted">{fmtDateTime(c.row.original.settled_at)}</span> },
    { accessorKey: "sport", header: "Sport" },
    { accessorKey: "league", header: "League", cell: (c) => c.row.original.league ?? <span className="text-dim">{MISSING}</span> },
    {
      accessorKey: "event_name", header: "Event", cell: ({ row: { original: b } }) => (
        <span className="flex max-w-[260px] items-center gap-1.5 truncate">
          {b.is_live && <Badge tone="up" className="px-1 py-0 text-[9px]">LIVE</Badge>}
          {b.kind === "accumulator" && <Badge tone="accent" className="px-1 py-0 text-[9px]">{b.legs.length}-FOLD</Badge>}
          <span className="truncate" title={b.event_name}>{b.event_name}</span>
        </span>
      ),
    },
    { accessorKey: "market", header: "Market", cell: (c) => <span className="block max-w-[130px] truncate text-muted">{c.row.original.market}</span> },
    { accessorKey: "line", header: "Line", cell: (c) => <span className="num">{c.row.original.line ?? MISSING}</span> },
    {
      accessorKey: "selection", header: "Selection", cell: ({ row: { original: b } }) => (
        <span className="flex max-w-[180px] items-center gap-1 truncate">{b.side === "lay" && <Badge tone="down" className="px-1 py-0 text-[9px]">LAY</Badge>}<span className="truncate">{b.selection}</span></span>
      ),
    },
    { accessorKey: "bookmaker", header: "Book", cell: (c) => <span className="text-muted">{c.row.original.bookmaker ?? MISSING}</span> },
    { accessorKey: "bankroll", header: "Bankroll" },
    { accessorKey: "odds", header: "Odds", cell: (c) => <span className="num">{formatOdds(c.row.original.odds, app.oddsFormat)}</span> },
    { accessorKey: "stake", header: "Stake", cell: (c) => <Money value={c.row.original.stake} ccy={ccyOf(c.row.original)} /> },
    { accessorKey: "commission", header: "Comm.", cell: (c) => <span className="num">{c.row.original.commission ? fmtPct(c.row.original.commission, 1) : MISSING}</span> },
    { id: "payout", accessorFn: (b) => b.actual_payout ?? b.potential_payout, header: "Payout", cell: (c) => <Money value={c.row.original.actual_payout ?? c.row.original.potential_payout} ccy={ccyOf(c.row.original)} className={c.row.original.actual_payout == null ? "text-dim" : ""} /> },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.row.original.status} /> },
    { accessorKey: "profit", header: "P/L", sortUndefined: "last", cell: (c) => <Money value={c.row.original.profit} ccy={ccyOf(c.row.original)} signed /> },
    { accessorKey: "est_probability", header: "Est. p", cell: (c) => <span className="num">{fmtPct(c.row.original.est_probability)}</span> },
    { id: "edge", accessorFn: (b) => (b.est_probability != null ? b.est_probability - 1 / b.odds : null), header: "Edge", cell: (c) => <span className="num">{fmtPct(c.getValue() as number | null, 1, true)}</span> },
    { id: "ev", accessorFn: evOf, header: "EV", cell: (c) => <Money value={c.getValue() as number | null} ccy={ccyOf(c.row.original)} signed /> },
    { accessorKey: "opening_odds", header: "Open", cell: (c) => <span className="num">{c.row.original.opening_odds?.toFixed(2) ?? MISSING}</span> },
    { accessorKey: "closing_odds", header: "Close", cell: (c) => <span className="num" title={c.row.original.closing_source ?? undefined}>{c.row.original.closing_odds?.toFixed(2) ?? MISSING}</span> },
    {
      id: "clv", accessorFn: clvOf, header: convention === "odds" ? "CLV %" : "CLV pp", sortUndefined: "last",
      cell: (c) => { const v = c.getValue() as number | null; return <span className={cn("num", v != null && v > 0 && "text-up", v != null && v < 0 && "text-down")}>{convention === "odds" ? fmtPct(v, 1, true) : fmtPp(v, 1)}</span>; },
    },
    { accessorKey: "strategy", header: "Strategy", cell: (c) => <span className="block max-w-[120px] truncate text-muted">{c.row.original.strategy ?? MISSING}</span> },
    { accessorKey: "confidence", header: "Conf.", cell: (c) => <span className="text-warn">{c.row.original.confidence ? "★".repeat(c.row.original.confidence) : ""}</span> },
    { accessorKey: "units", header: "Units", cell: (c) => <span className="num">{c.row.original.units ?? MISSING}</span> },
    { accessorKey: "correlation_group", header: "Corr. group" },
    { id: "tags", accessorFn: (b) => b.tags.join(", "), header: "Tags", cell: (c) => <span className="flex gap-0.5">{c.row.original.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span> },
    {
      id: "actions", enableSorting: false, enableHiding: false, header: "",
      cell: ({ row: { original: b } }) => (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Bet actions" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-3.5 w-3.5" /></Button></MenuTrigger>
          <MenuContent onClick={(e) => e.stopPropagation()}>
            <MenuLabel>Bet #{b.ref}</MenuLabel>
            {b.status === "pending" && <MenuItem onSelect={() => setSettling(b)}><Trophy className="h-3.5 w-3.5" /> Settle / cash out</MenuItem>}
            {b.status !== "pending" && <MenuItem onSelect={() => act(() => reopenBet(b.id), "Bet reopened")}><RotateCcw className="h-3.5 w-3.5" /> Reopen (reverse settlement)</MenuItem>}
            <MenuItem onSelect={() => setEditing(b)}><Pencil className="h-3.5 w-3.5" /> Edit</MenuItem>
            <MenuItem onSelect={() => act(() => duplicateBet(b.id), "Bet duplicated")}><Copy className="h-3.5 w-3.5" /> Duplicate</MenuItem>
            <MenuItem onSelect={() => setDetail(b)}><Eye className="h-3.5 w-3.5" /> Details & audit trail</MenuItem>
            <MenuSeparator />
            <MenuItem className="text-down" onSelect={() => { if (confirm(`Delete bet #${b.ref}? Its ledger effect is reversed; the record is kept in the audit trail.`)) act(() => deleteBets([b.id]), "Bet deleted"); }}><Trash2 className="h-3.5 w-3.5" /> Delete</MenuItem>
          </MenuContent>
        </Menu>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [convention, app.oddsFormat]);

  const table = useReactTable({
    data: filtered, columns, getRowId: (r) => r.id,
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, onRowSelectionChange: setSelection,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } }, enableRowSelection: true,
  });

  function act<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, msg: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else { toast.success(msg); setSelection({}); router.refresh(); }
    });
  }
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const selectedBets = bets.filter((b) => selection[b.id]);
  const selPending = selectedBets.filter((b) => b.status === "pending" && b.kind === "single");

  // Footer totals per currency for the filtered set.
  const totals = React.useMemo(() => {
    const m = new Map<string, { stake: number; profit: number; n: number }>();
    for (const b of filtered) {
      const t = m.get(b.currency) ?? { stake: 0, profit: 0, n: 0 };
      t.n++; if (b.status !== "pending") { t.stake += b.stake; t.profit += b.profit ?? 0; }
      m.set(b.currency, t);
    }
    return [...m.entries()];
  }, [filtered]);

  const applyView = (cfg: Record<string, unknown>) => {
    setFilters({ ...EMPTY, ...(cfg.filters as Partial<Filters>) });
    if (cfg.sorting) setSorting(cfg.sorting as SortingState);
    if (cfg.visibility) setVisibility(cfg.visibility as VisibilityState);
  };
  const activeFilters = Object.entries(filters).filter(([, v]) => v).length;
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Bet Tracker" description={`${filtered.length.toLocaleString()} of ${bets.length.toLocaleString()} bets${truncated ? " · showing the most recent 50,000" : ""}`}
        actions={<>
          <Button variant="outline" onClick={() => setImportOpen(true)}><FileUp className="h-3.5 w-3.5" /> Import</Button>
          <Menu>
            <MenuTrigger asChild><Button variant="outline"><Download className="h-3.5 w-3.5" /> Export</Button></MenuTrigger>
            <MenuContent>
              <MenuLabel>{filtered.length} filtered bets</MenuLabel>
              <MenuItem onSelect={() => exportBets(filtered, "csv", convention)}>CSV</MenuItem>
              <MenuItem onSelect={() => exportBets(filtered, "xlsx", convention)}>Excel (.xlsx)</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => location.assign("/api/export/backup")}>Full JSON backup</MenuItem>
            </MenuContent>
          </Menu>
          <Button onClick={() => newBet.open()}>New bet</Button>
        </>} />

      <Panel bodyClassName="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
          <Input className="w-56" placeholder="Search event, selection, #ref, tag…" value={filters.q} onChange={set("q")} />
          <Select className="w-32" value={filters.status} onChange={set("status")} aria-label="Status">
            <option value="">All statuses</option><option value="settled">Settled</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select className="w-36" value={filters.sport} onChange={set("sport")} aria-label="Sport"><option value="">All sports</option>{app.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Button variant={showFilters || activeFilters > 2 ? "default" : "outline"} onClick={() => setShowFilters((s) => !s)}><Filter className="h-3.5 w-3.5" /> Filters{activeFilters ? ` (${activeFilters})` : ""}</Button>
          {activeFilters > 0 && <Button variant="ghost" onClick={() => setFilters(EMPTY)}>Clear</Button>}
          <div className="ml-auto flex items-center gap-1.5">
            <Menu>
              <MenuTrigger asChild><Button variant="outline"><Save className="h-3.5 w-3.5" /> Views</Button></MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => {
                  const name = prompt("Save current filters, sorting and columns as:");
                  if (name) act(() => saveView(name, { filters, sorting, visibility }), "View saved");
                }}>Save current view…</MenuItem>
                {views.length > 0 && <MenuSeparator />}
                {views.map((v) => (
                  <MenuItem key={v.id} onSelect={() => applyView(v.config)} className="justify-between">
                    {v.name}
                    <button className="text-dim hover:text-down" onClick={(e) => { e.stopPropagation(); act(() => deleteView(v.id), "View deleted"); }} aria-label={`Delete view ${v.name}`}><Trash2 className="h-3 w-3" /></button>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild><Button variant="outline"><Columns3 className="h-3.5 w-3.5" /> Columns</Button></MenuTrigger>
              <MenuContent className="max-h-80 overflow-y-auto">
                {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                  <MenuItem key={c.id} onSelect={(e) => { e.preventDefault(); c.toggleVisibility(); }}>
                    <Checkbox readOnly checked={c.getIsVisible()} /> {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </MenuItem>
                ))}
                <MenuSeparator /><MenuItem onSelect={() => setVisibility(DEFAULT_HIDDEN)}>Reset columns</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-1.5 border-b border-line bg-panel-2 p-2 md:grid-cols-6">
            <Select value={filters.bookmaker} onChange={set("bookmaker")} aria-label="Bookmaker"><option value="">All bookmakers</option>{app.bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <Select value={filters.strategy} onChange={set("strategy")} aria-label="Strategy"><option value="">All strategies</option><option value="none">No strategy</option>{app.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Select value={filters.bankroll} onChange={set("bankroll")} aria-label="Bankroll"><option value="">All bankrolls</option>{app.bankrolls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <Select value={filters.mode} onChange={set("mode")} aria-label="Timing"><option value="">Pre-match & live</option><option value="pre">Pre-match</option><option value="live">Live</option></Select>
            <Select value={filters.side} onChange={set("side")} aria-label="Side"><option value="">Back & lay</option><option value="back">Back</option><option value="lay">Lay</option></Select>
            <Select value={filters.kind} onChange={set("kind")} aria-label="Type"><option value="">Singles & accas</option><option value="single">Singles</option><option value="accumulator">Accumulators</option></Select>
            <Input type="date" value={filters.from} onChange={set("from")} aria-label="Placed from" />
            <Input type="date" value={filters.to} onChange={set("to")} aria-label="Placed to" />
            <Input inputMode="decimal" placeholder="Min odds" value={filters.minOdds} onChange={set("minOdds")} />
            <Input inputMode="decimal" placeholder="Max odds" value={filters.maxOdds} onChange={set("maxOdds")} />
            <Input placeholder="Tag" value={filters.tag} onChange={set("tag")} />
          </div>
        )}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-accent-soft/30 px-2 py-1.5 text-xs">
            <b>{selectedIds.length} selected</b>
            <span className="text-muted">· settle {selPending.length} pending single(s) as</span>
            {(["won", "lost", "void", "half_won", "half_lost"] as const).map((s) => (
              <Button key={s} size="sm" variant="outline" disabled={!selPending.length || busy}
                onClick={() => act(() => bulkSettle(selPending.map((b) => b.id), s), `${selPending.length} bets settled ${STATUS_LABEL[s]}`)}>{STATUS_LABEL[s]}</Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => setBulkEdit(true)}><Pencil className="h-3 w-3" /> Bulk edit</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (confirm(`Delete ${selectedIds.length} bets? Ledger effects are reversed.`)) act(() => deleteBets(selectedIds), "Bets deleted"); }}><Trash2 className="h-3 w-3" /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelection({})}>Clear</Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-panel-2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>{hg.headers.map((h) => (
                  <th key={h.id} className="label-xs h-7 whitespace-nowrap px-2 text-left font-medium">
                    {h.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1 hover:text-fg" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() ? (h.column.getIsSorted() === "desc" ? "↓" : "↑") : <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}</tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} className={cn("cursor-pointer border-b border-line/60 hover:bg-raised/60", r.getIsSelected() && "bg-accent-soft/20")} onDoubleClick={() => setEditing(r.original)} onClick={() => setDetail(r.original)}>
                  {r.getVisibleCells().map((c) => <td key={c.id} className="h-7 whitespace-nowrap px-2" onClick={c.column.id === "select" || c.column.id === "actions" ? (e) => e.stopPropagation() : undefined}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={40} className="py-10 text-center text-dim">{bets.length ? "No bets match these filters." : "No bets yet. Press N or click New bet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-2 py-1.5 text-[11px] text-muted">
          {totals.map(([ccy, t]) => (
            <span key={ccy} className="num">{ccy}: {t.n} bets · settled stake <Money value={t.stake} ccy={ccy} /> · P/L <Money value={t.profit} ccy={ccy} signed /> · ROI {fmtPct(t.stake ? t.profit / t.stake : null, 2, true)}</span>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <Select className="w-20" value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))} aria-label="Rows per page">
              {[25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}/page</option>)}
            </Select>
            <Button size="sm" variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Prev</Button>
            <span className="num">{table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
            <Button size="sm" variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
          </div>
        </div>
      </Panel>

      {editing && <BetFormDialog open onOpenChange={(o) => !o && setEditing(null)} existing={{ ...editing, bet_legs: editing.legs } as never} />}
      {settling && <SettleDialog bet={settling} onClose={() => setSettling(null)} />}
      {detail && <BetDetail bet={detail} convention={convention} onClose={() => { setDetail(null); if (focusBet) router.replace("/bets"); }} onEdit={() => { setEditing(detail); setDetail(null); }} onSettle={() => { setSettling(detail); setDetail(null); }} />}
      <ImportDialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o && openImport) router.replace("/bets"); }} />
      <BulkEditDialog open={bulkEdit} onOpenChange={setBulkEdit} ids={selectedIds} onDone={() => { setSelection({}); router.refresh(); }} />
      {busy && <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded bg-raised px-3 py-1 text-xs text-muted"><Scissors className="mr-1 inline h-3 w-3" />Working…</div>}
    </div>
  );
}

function BulkEditDialog({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; onDone: () => void }) {
  const app = useAppData();
  const [strategy, setStrategy] = React.useState("__keep");
  const [tags, setTags] = React.useState("");
  const [confidence, setConfidence] = React.useState("__keep");
  const [group, setGroup] = React.useState("");
  const [bookmaker, setBookmaker] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (strategy !== "__keep") patch.strategy_id = strategy || null;
    if (tags.trim()) patch.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (confidence !== "__keep") patch.confidence = confidence ? Number(confidence) : null;
    if (group.trim()) patch.correlation_group = group.trim() === "-" ? null : group.trim();
    if (bookmaker) patch.bookmaker_id = bookmaker;
    if (!Object.keys(patch).length) return toast.error("Nothing to change");
    setBusy(true);
    const r = await bulkUpdate(ids, patch as never);
    setBusy(false);
    if (!r.ok) toast.error(r.error); else { toast.success(`${r.data} bets updated`); onOpenChange(false); onDone(); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Bulk edit ${ids.length} bets`} description="Only descriptive fields. Financial fields must be edited per bet.">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="label-xs flex flex-col gap-1">Strategy<Select value={strategy} onChange={(e) => setStrategy(e.target.value)}><option value="__keep">(unchanged)</option><option value="">None</option>{app.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
          <label className="label-xs flex flex-col gap-1">Confidence<Select value={confidence} onChange={(e) => setConfidence(e.target.value)}><option value="__keep">(unchanged)</option><option value="">None</option>{[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>{c}</option>)}</Select></label>
          <label className="label-xs flex flex-col gap-1">Replace tags<Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="(unchanged)" /></label>
          <label className="label-xs flex flex-col gap-1">Correlation group<Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="(unchanged, '-' clears)" /></label>
          <label className="label-xs flex flex-col gap-1">Bookmaker<Select value={bookmaker} onChange={(e) => setBookmaker(e.target.value)}><option value="">(unchanged)</option>{app.bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={save} disabled={busy}>Apply</Button></div>
      </DialogContent>
    </Dialog>
  );
}
