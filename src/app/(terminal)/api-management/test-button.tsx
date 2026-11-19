"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function TestButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [res, setRes] = useState<{ ok: boolean; detail: string; ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={disabled || busy} onClick={async () => {
        setBusy(true);
        try { setRes(await (await fetch(`/api/providers/test?id=${id}`, { method: "POST" })).json()); } catch { setRes({ ok: false, detail: "request failed" }); }
        setBusy(false);
      }}>{busy ? "Testing…" : "Test connection"}</Button>
      {res && <span className={res.ok ? "text-up" : "text-down"}>{res.ok ? "✓" : "✗"} {res.detail}{res.ms != null ? ` · ${res.ms}ms` : ""}</span>}
    </div>
  );
}
