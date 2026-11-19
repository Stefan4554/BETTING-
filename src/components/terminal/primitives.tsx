import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Info, PlugZap, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { LiveScore, Match, MatchStatus } from "@/lib/domain";
import { fmtAgo, fmtDateTime, fmtPct, MISSING } from "@/lib/format";
import type { Notice } from "@/lib/data/service";

export function Panel({
  title, actions, children, className, bodyClassName, subtitle,
}: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-[3px] border border-line bg-panel", className)}>
      {title !== undefined && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-fg/90">{title}</h2>
            {subtitle && <span className="truncate text-[11px] text-dim">{subtitle}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" | "neutral" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-line px-3 py-2 last:border-r-0">
      <span className="label-xs truncate">{label}</span>
      <span className={cn("num text-lg leading-6", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</span>
      {sub && <span className="truncate text-[11px] text-dim">{sub}</span>}
    </div>
  );
}

/** Explicit marker for data the source did not provide. */
export function Missing({ reason = "Not provided by data source" }: { reason?: string }) {
  return (
    <span className="text-dim" title={reason} aria-label={reason}>
      {MISSING}
    </span>
  );
}

export function Delta({ value, invert = false, digits = 1 }: { value: number | null | undefined; invert?: boolean; digits?: number }) {
  if (value == null || !Number.isFinite(value)) return <Missing reason="No opening price recorded" />;
  const up = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.0005;
  return (
    <span className={cn("num", flat ? "text-muted" : up ? "text-up" : "text-down")}>
      {flat ? "·" : value > 0 ? "▲" : "▼"} {fmtPct(Math.abs(value), digits)}
    </span>
  );
}

const STATUS_TONE: Record<MatchStatus, "up" | "down" | "warn" | "neutral" | "accent"> = {
  live: "up", suspended: "warn", interrupted: "warn", delayed: "warn", scheduled: "accent",
  completed: "neutral", retired: "neutral", walkover: "neutral", cancelled: "down", postponed: "warn", unknown: "neutral",
};

export function StatusPill({ status }: { status: MatchStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === "live" && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-up" />}
      {status === "unknown" ? "status n/a" : status}
    </Badge>
  );
}

export function SourceTag({ provider, at, className }: { provider: string; at?: string | null; className?: string }) {
  const demo = provider === "demo";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10.5px] text-dim", className)} title={at ? fmtDateTime(at) : undefined}>
      <span className={cn("rounded-[2px] px-1", demo ? "bg-demo/15 text-demo" : "bg-raised text-muted")}>{demo ? "DEMO" : provider}</span>
      {at && <span className="num">{fmtAgo(at)}</span>}
    </span>
  );
}

export function ScoreLine({ score, className }: { score: LiveScore | null; className?: string }) {
  if (!score) return <Missing reason="No score yet" />;
  return (
    <span className={cn("num inline-flex items-center gap-1.5", className)}>
      {score.sets.map((s, i) => (
        <span key={i} className="text-fg">
          {s.a}-{s.b}
          {s.tiebreakA != null && s.tiebreakB != null && <sup className="text-dim">{Math.min(s.tiebreakA, s.tiebreakB)}</sup>}
        </span>
      ))}
      {score.game && (
        <span className="rounded-[2px] bg-accent-soft px-1 text-accent">
          {score.game.a}-{score.game.b}
        </span>
      )}
    </span>
  );
}

export function PlayerName({ name, server, winner, rank, href }: { name: string; server?: boolean; winner?: boolean; rank?: number | null; href?: string }) {
  const inner = (
    <span className={cn("inline-flex items-center gap-1.5 truncate", winner && "font-semibold text-fg", winner === false && "text-muted")}>
      {server && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Serving" />}
      <span className="truncate">{name}</span>
      {rank != null && <span className="num text-[10.5px] text-dim">#{rank}</span>}
    </span>
  );
  return href ? <Link href={href} className="hover:text-accent">{inner}</Link> : inner;
}

export function MatchLabel({ m }: { m: Match }) {
  return (
    <Link href={`/matches/${encodeURIComponent(m.id)}`} className="flex min-w-0 flex-col leading-4 hover:text-accent">
      <PlayerName name={m.playerA.name} server={m.score?.server === "a"} winner={m.winner ? m.winner === "a" : undefined} rank={m.playerA.rank} />
      <PlayerName name={m.playerB.name} server={m.score?.server === "b"} winner={m.winner ? m.winner === "b" : undefined} rank={m.playerB.rank} />
    </Link>
  );
}

export function EmptyState({ title, children, icon = "plug" }: { title: string; children?: React.ReactNode; icon?: "plug" | "info" }) {
  const Icon = icon === "plug" ? PlugZap : Info;
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon className="h-5 w-5 text-dim" />
      <p className="text-sm text-fg/90">{title}</p>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}

export function Notices({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {notices.map((n, i) => {
        const Icon = n.level === "error" ? XCircle : n.level === "warn" ? AlertTriangle : Info;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded-[3px] border px-3 py-1.5 text-xs",
              n.level === "error" && "border-down/40 bg-down-soft text-down",
              n.level === "warn" && "border-warn/30 bg-warn-soft text-warn",
              n.level === "info" && "border-line-strong bg-panel-2 text-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {n.text}
          </div>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ProbBar({ a, label }: { a: number | null; label?: string }) {
  if (a == null) return <Missing reason="Insufficient data for a probability" />;
  return (
    <div className="flex items-center gap-2" title={label}>
      <span className="num w-10 text-right">{fmtPct(a, 0)}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-down/40">
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${a * 100}%` }} />
      </div>
      <span className="num w-10 text-muted">{fmtPct(1 - a, 0)}</span>
    </div>
  );
}
