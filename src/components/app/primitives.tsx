import * as React from "react";
import { AlertTriangle, Info, PlugZap, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { fmtMoney, fmtPct, MISSING, STATUS_LABEL } from "@/lib/format";

export function Panel({ title, subtitle, actions, children, className, bodyClassName, id }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section id={id} className={cn("flex min-w-0 flex-col rounded-[3px] border border-line bg-panel", className)}>
      {title !== undefined && (
        <header className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1">
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

export type Tone = "up" | "down" | "neutral" | "warn";
export const toneOf = (x: number | null | undefined, eps = 1e-9): Tone => (x == null || Math.abs(x) < eps ? "neutral" : x > 0 ? "up" : "down");

export function Kpi({ label, value, sub, tone, hint, delta }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; hint?: string; delta?: { value: number | null; invert?: boolean } | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[3px] border border-line bg-panel px-3 py-2" title={hint}>
      <span className="label-xs truncate">{label}</span>
      <span className={cn("num truncate text-[17px] leading-6", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>{value}</span>
      <div className="flex min-h-4 items-center gap-2 text-[11px] text-dim">
        {delta && <DeltaChip value={delta.value} invert={delta.invert} />}
        {sub && <span className="truncate">{sub}</span>}
      </div>
    </div>
  );
}

export function DeltaChip({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-dim" title="No comparable previous period">vs prev —</span>;
  const good = invert ? value < 0 : value > 0;
  return <span className={cn("num", Math.abs(value) < 0.0005 ? "text-muted" : good ? "text-up" : "text-down")}>{value > 0 ? "▲" : value < 0 ? "▼" : "·"} {fmtPct(Math.abs(value), 1)}</span>;
}

export function Money({ value, ccy, signed, className }: { value: number | null | undefined; ccy: string; signed?: boolean; className?: string }) {
  return <span className={cn("num", signed && value != null && value > 0.004 && "text-up", signed && value != null && value < -0.004 && "text-down", className)}>{fmtMoney(value, ccy, signed)}</span>;
}

export function Pct({ value, signed = true, digits = 1, className }: { value: number | null | undefined; signed?: boolean; digits?: number; className?: string }) {
  return <span className={cn("num", signed && value != null && value > 0 && "text-up", signed && value != null && value < 0 && "text-down", className)}>{fmtPct(value, digits, signed)}</span>;
}

export function Missing({ reason = "Not available" }: { reason?: string }) {
  return <span className="text-dim" title={reason} aria-label={reason}>{MISSING}</span>;
}

const STATUS_TONE: Record<string, "up" | "down" | "warn" | "neutral" | "accent"> = {
  pending: "accent", won: "up", half_won: "up", lost: "down", half_lost: "down", void: "neutral", cashed_out: "warn",
  open: "accent", settled: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, icon = "info", action }: { title: string; children?: React.ReactNode; icon?: "plug" | "info"; action?: React.ReactNode }) {
  const Icon = icon === "plug" ? PlugZap : Info;
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon className="h-5 w-5 text-dim" />
      <p className="text-sm text-fg/90">{title}</p>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ level = "info", children, className }: { level?: "info" | "warn" | "error"; children: React.ReactNode; className?: string }) {
  const Icon = level === "error" ? XCircle : level === "warn" ? AlertTriangle : Info;
  return (
    <div className={cn("flex items-start gap-2 rounded-[3px] border px-3 py-1.5 text-xs",
      level === "error" && "border-down/40 bg-down-soft text-down",
      level === "warn" && "border-warn/30 bg-warn-soft text-warn",
      level === "info" && "border-line-strong bg-panel-2 text-muted", className)}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" /><div>{children}</div>
    </div>
  );
}

export function SampleWarning({ n, min = 30, what = "settled bets" }: { n: number; min?: number; what?: string }) {
  if (n >= min) return null;
  return <Notice level="warn">Small sample: {n} {what}. Statistics below {min} are highly uncertain and should not be used to judge an edge.</Notice>;
}

export function KV({ k, v, className }: { k: React.ReactNode; v: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line/60 py-1 text-xs last:border-0", className)}>
      <span className="text-muted">{k}</span><span className="num text-right">{v}</span>
    </div>
  );
}
