"use client";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bet } from "@/lib/engine/bets";
import type { BetStorage } from "@/lib/data/bets";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export interface UserSettings {
  bankroll: number;
  kellyFraction: number;
  maxStakePct: number;
  modelConfidence: number;
  minEdge: number;
  minDataQuality: number;
  maxDivergence: number;
  oddsFormat: "decimal" | "american";
  currency: string;
}
export const DEFAULT_SETTINGS: UserSettings = {
  bankroll: 1000, kellyFraction: 0.25, maxStakePct: 0.02, modelConfidence: 0.5, minEdge: 0.02, minDataQuality: 0.5, maxDivergence: 0.1, oddsFormat: "decimal", currency: "EUR",
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings({ ...DEFAULT_SETTINGS, ...readLocal<Partial<UserSettings>>("edge.settings", {}) }), []);
  const update = useCallback((patch: Partial<UserSettings>) => {
    setSettings((s) => {
      const n = { ...s, ...patch };
      writeLocal("edge.settings", n);
      return n;
    });
  }, []);
  return [settings, update] as const;
}

/**
 * Bets for the tracker. Storage is decided server-side:
 *  demo → sample history + your edits in this browser; local → this browser only; supabase → your account (RLS).
 */
export function useBets(storage: BetStorage, initial: Bet[]) {
  const qc = useQueryClient();
  const localKey = storage === "demo" ? "edge.demo.bets" : "edge.bets";
  const [local, setLocal] = useState<Bet[]>(initial);

  useEffect(() => {
    if (storage !== "supabase") setLocal(readLocal<Bet[]>(localKey, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  const remote = useQuery({
    queryKey: ["bets"],
    enabled: storage === "supabase",
    initialData: { bets: initial },
    queryFn: async () => {
      const r = await fetch("/api/bets");
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load bets");
      return (await r.json()) as { bets: Bet[] };
    },
  });

  const call = useMutation({
    mutationFn: async ({ method, body, id }: { method: "POST" | "PATCH" | "DELETE"; body?: unknown; id?: string }) => {
      const r = await fetch(`/api/bets${id ? `?id=${id}` : ""}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error((await r.json()).error ?? "Request failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bets"] }),
  });

  const saveLocal = (b: Bet[]) => {
    setLocal(b);
    writeLocal(localKey, b);
  };

  const bets = storage === "supabase" ? remote.data?.bets ?? [] : local;
  return {
    bets,
    error: (remote.error as Error | null)?.message ?? (call.error as Error | null)?.message ?? null,
    busy: call.isPending,
    add: (b: Omit<Bet, "id">) =>
      storage === "supabase" ? call.mutate({ method: "POST", body: b }) : saveLocal([{ ...b, id: crypto.randomUUID() }, ...local]),
    update: (id: string, patch: Partial<Bet>) =>
      storage === "supabase"
        ? call.mutate({ method: "PATCH", body: { id, ...patch } })
        : saveLocal(local.map((b) => (b.id === id ? { ...b, ...patch, settledAt: patch.status && patch.status !== "pending" ? new Date().toISOString() : b.settledAt } : b))),
    remove: (id: string) => (storage === "supabase" ? call.mutate({ method: "DELETE", id }) : saveLocal(local.filter((b) => b.id !== id))),
    reset: storage === "demo" ? () => saveLocal(initial) : undefined,
  };
}

/** Hosts that cannot use a plain download link (the Claude artifact build) set this. */
type SaveHook = (filename: string, text: string, type: string) => void;
export function downloadText(filename: string, text: string, type = "text/csv") {
  const hook = (globalThis as { __edgeSaveFile?: SaveHook }).__edgeSaveFile;
  if (hook) return hook(filename, text, type);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useSort<T>(rows: T[], initialKey: keyof T | null = null, initialDir: "asc" | "desc" = "desc") {
  const [key, setKey] = useState<keyof T | null>(initialKey);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);
  const sorted = key
    ? [...rows].sort((a, b) => {
        const x = a[key] as unknown, y = b[key] as unknown;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return dir === "asc" ? c : -c;
      })
    : rows;
  const toggle = (k: keyof T) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setKey(k);
      setDir("desc");
    }
  };
  return { sorted, key, dir, toggle };
}
