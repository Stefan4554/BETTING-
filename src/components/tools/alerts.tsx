"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/app/primitives";
import { deleteAlert, markAlertsRead } from "@/app/actions/settings";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPES: Record<string, string> = {
  bet_settled: "Bet settled", large_result: "Large profit/loss", daily_loss: "Daily loss", weekly_loss: "Weekly loss", drawdown: "Drawdown", odds_movement: "Odds movement",
  clv_update: "CLV update", api_failure: "API failure", exposure: "Exposure", stake_limit: "Stake limit", goal_progress: "Goal progress", system: "System",
};

export function AlertsView({ alerts }: { alerts: Tables<"alerts">[] }) {
  const router = useRouter();
  const [type, setType] = React.useState("");
  const [unread, setUnread] = React.useState(false);
  const list = alerts.filter((a) => (!type || a.type === type) && (!unread || !a.read_at));
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Notification center" description="In-app alerts. Email delivery is available when the server email integration is configured." actions={
        <Button variant="outline" onClick={async () => { const r = await markAlertsRead(); if (!r.ok) toast.error(r.error); else router.refresh(); }}>Mark all read</Button>} />
      <div className="flex gap-1.5">
        <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Button variant={unread ? "default" : "outline"} onClick={() => setUnread((x) => !x)}>Unread only</Button>
      </div>
      <Panel>
        {list.map((a) => (
          <div key={a.id} className={cn("flex items-start gap-3 border-b border-line/60 px-3 py-2 text-xs", !a.read_at && "bg-accent-soft/15")}>
            <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-down" : a.severity === "warning" ? "bg-warn" : "bg-accent")} title={a.severity} />
            <div className="flex-1"><div className="font-medium">{a.title} <span className="ml-1 font-normal text-dim">{TYPES[a.type]} · {a.severity}</span></div>{a.body && <div className="text-muted">{a.body}</div>}</div>
            <span className="num shrink-0 text-dim">{fmtDateTime(a.created_at)}</span>
            {!a.read_at && <button className="text-[11px] text-accent" onClick={async () => { await markAlertsRead([a.id]); router.refresh(); }}>read</button>}
            <button className="text-dim hover:text-down" aria-label="Delete" onClick={async () => { await deleteAlert(a.id); router.refresh(); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {!list.length && <p className="p-8 text-center text-xs text-dim">No alerts.</p>}
      </Panel>
    </div>
  );
}
