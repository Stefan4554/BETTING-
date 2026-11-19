"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";

type Hit = { type: "match" | "player" | "tournament" | "page"; id: string; label: string; sub?: string; href: string };

export function Topbar({ mode, user, authEnabled }: { mode: "demo" | "live"; user: string | null; authEnabled: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState<string>("");
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const t = () => setNow(new Date().toISOString().slice(11, 19) + " UTC");
    t();
    const i = setInterval(t, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pages = useMemo<Hit[]>(() => NAV.flatMap((g) => g.items.map((i) => ({ type: "page" as const, id: i.href, label: i.label, href: i.href }))), []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const local = pages.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { hits: [] }))
      .then((d: { hits: Hit[] }) => setHits([...local, ...d.hits].slice(0, 12)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [q, pages]);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <button className="md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">
        <Menu className="h-4 w-4" />
      </button>
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) router.push(hits[0].href);
          }}
          placeholder="Search players, matches, tournaments, pages…  ( / )"
          className="h-7 w-full rounded-[3px] border border-line-strong bg-panel-2 pl-7 pr-2 text-xs placeholder:text-dim focus:border-accent focus:outline-none"
        />
        {open && hits.length > 0 && (
          <div className="absolute left-0 right-0 top-8 z-50 max-h-80 overflow-auto rounded-[3px] border border-line-strong bg-panel-2 shadow-xl">
            {hits.map((h) => (
              <Link key={h.type + h.id} href={h.href} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs hover:bg-raised">
                <span className="truncate">{h.label}</span>
                <span className="label-xs shrink-0">{h.sub ?? h.type}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span
          className={cn(
            "rounded-[2px] border px-1.5 py-0.5 text-[10.5px] font-bold tracking-wider",
            mode === "demo" ? "border-demo/50 bg-demo/15 text-demo" : "border-up/40 bg-up-soft text-up",
          )}
          title={mode === "demo" ? "Synthetic data — not live" : "Live provider data"}
        >
          {mode === "demo" ? "DEMO DATA" : "LIVE MODE"}
        </span>
        <span className="num hidden text-[11px] text-muted sm:inline">{now}</span>
        {authEnabled ? (
          user ? (
            <form action="/auth/signout" method="post">
              <button className="text-[11px] text-muted hover:text-fg" title="Sign out">{user}</button>
            </form>
          ) : (
            <Link href="/login" className="text-[11px] text-accent">Sign in</Link>
          )
        ) : (
          <span className="text-[10.5px] text-dim" title="Supabase is not configured, so authentication is disabled">auth off</span>
        )}
      </div>
      {menu && (
        <div className="fixed inset-0 top-11 z-40 overflow-auto bg-panel p-3 md:hidden" onClick={() => setMenu(false)}>
          {NAV.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="label-xs mb-1">{g.group}</div>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="block py-1.5 text-sm">
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
