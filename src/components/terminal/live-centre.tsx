"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { LiveMatchView } from "@/lib/data/live";
import { fmtAgo, fmtOdds, fmtPct, ratio } from "@/lib/format";
import { EmptyState, Missing, Panel, ScoreLine, SourceTag, StatusPill } from "./primitives";
import { Badge } from "@/components/ui/badge";

type LiveResponse = { mode: string; pollMs: number; at: string; matches: LiveMatchView[] };

export function LiveCentre({ initial }: { initial: LiveResponse }) {
  const q = useQuery({
    queryKey: ["live"],
    initialData: initial,
    queryFn: async () => (await (await fetch("/api/live")).json()) as LiveResponse,
    refetchInterval: (query) => query.state.data?.pollMs ?? 15_000,
  });
  const d = q.data;
  return (
    <>
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className={q.isFetching ? "text-accent" : ""}>●</span>
        Updated {fmtAgo(d.at)} · polling every {Math.round(d.pollMs / 1000)}s (within provider rate limits)
        {q.isError && <span className="text-down">· update failed, retrying</span>}
      </div>
      {d.matches.length === 0 ? (
        <Panel><EmptyState icon="info" title="No matches in progress">Live matches appear here automatically when the data provider reports them.</EmptyState></Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {d.matches.map((v) => <LiveCard key={v.match.id} v={v} />)}
        </div>
      )}
    </>
  );
}

function LiveCard({ v }: { v: LiveMatchView }) {
  const m = v.match;
  const halted = m.status !== "live";
  const row = (label: string, a: React.ReactNode, b: React.ReactNode) => (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-0.5">
      <span className="num text-right">{a}</span>
      <span className="label-xs w-28 text-center">{label}</span>
      <span className="num">{b}</span>
    </div>
  );
  const pct = (n: number | null | undefined, d: number | null | undefined) => {
    const r = ratio(n, d);
    return r == null ? <Missing /> : fmtPct(r, 0);
  };
  const sa = v.stats?.a, sb = v.stats?.b;
  return (
    <Panel
      title={<Link href={`/matches/${encodeURIComponent(m.id)}`} className="hover:text-accent">{m.tournament.name}{m.round ? ` · ${m.round}` : ""}</Link>}
      actions={<StatusPill status={m.status} />}
    >
      {halted && (
        <div className="border-b border-warn/30 bg-warn-soft px-3 py-1 text-[11px] text-warn">
          Match {m.status}. Odds shown may be suspended or stale; live probability is paused until play resumes.
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2">
        {(["a", "b"] as const).map((side) => {
          const p = side === "a" ? m.playerA : m.playerB;
          return (
            <div key={side} className="contents">
              <div className="flex items-center gap-2 py-0.5 text-sm">
                <span className={`h-2 w-2 rounded-full ${m.score?.server === side ? "bg-warn" : "bg-transparent"}`} title={m.score?.server === side ? "Serving" : undefined} />
                <span className="truncate">{p.name}</span>
                {p.rank && <span className="num text-[10.5px] text-dim">#{p.rank}</span>}
              </div>
              <div className="num flex items-center gap-2 text-sm">
                {(m.score?.sets ?? []).map((s, i) => <span key={i} className="w-4 text-center">{side === "a" ? s.a : s.b}</span>)}
                <span className="w-7 rounded-[2px] bg-accent-soft text-center text-accent">{m.score?.game ? (side === "a" ? m.score.game.a : m.score.game.b) : "–"}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-px border-y border-line bg-line text-center">
        <div className="bg-panel py-1.5"><div className="label-xs">Live odds A / B</div><div className="num">{fmtOdds(v.bestA)} / {fmtOdds(v.bestB)}</div></div>
        <div className="bg-panel py-1.5"><div className="label-xs">Pre-match model A</div><div className="num">{v.preMatchA == null ? <Missing reason="Insufficient history" /> : fmtPct(v.preMatchA, 0)}</div></div>
        <div className="bg-panel py-1.5"><div className="label-xs">Live win prob A</div><div className="num text-accent">{halted || v.liveA == null ? <Missing reason={halted ? "Paused" : "Needs pre-match model + score"} /> : fmtPct(v.liveA, 0)}</div></div>
      </div>
      <div className="px-3 py-2 text-xs">
        {v.stats ? (
          <>
            {row("Aces", sa?.aces ?? <Missing />, sb?.aces ?? <Missing />)}
            {row("Double faults", sa?.doubleFaults ?? <Missing />, sb?.doubleFaults ?? <Missing />)}
            {row("1st serve in", pct(sa?.firstServeIn, sa?.firstServeAttempts), pct(sb?.firstServeIn, sb?.firstServeAttempts))}
            {row("1st serve won", pct(sa?.firstServePointsWon, sa?.firstServePointsPlayed), pct(sb?.firstServePointsWon, sb?.firstServePointsPlayed))}
            {row("Break pts won", sa?.breakPointsConverted != null ? `${sa.breakPointsConverted}/${sa.breakPointsOpportunities ?? "?"}` : <Missing />, sb?.breakPointsConverted != null ? `${sb.breakPointsConverted}/${sb.breakPointsOpportunities ?? "?"}` : <Missing />)}
          </>
        ) : (
          <p className="text-center text-muted">Live statistics not provided for this match.</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-1">
        <SourceTag provider={m.source.provider} at={m.source.updatedAt ?? m.source.fetchedAt} />
        {v.oddsUpdatedAt && <span className="text-[10.5px] text-dim">odds {fmtAgo(v.oddsUpdatedAt)}</span>}
        <Link href={`/matches/${encodeURIComponent(m.id)}`}><Badge tone="accent">Match centre</Badge></Link>
      </div>
      <div className="hidden"><ScoreLine score={m.score} /></div>
    </Panel>
  );
}
