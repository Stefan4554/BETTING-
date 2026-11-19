"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV, SPORTS } from "./nav";

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-panel md:flex">
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <div className="grid h-6 w-6 place-items-center rounded-[3px] bg-accent text-[11px] font-black text-white">E</div>
        <div className="leading-3">
          <div className="text-[12px] font-bold tracking-[0.18em]">EDGE</div>
          <div className="text-[9px] tracking-[0.28em] text-muted">INTELLIGENCE</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-1 gap-y-0.5 border-b border-line px-2 py-2">
        {SPORTS.map((s) => (
          <span
            key={s.key}
            title={s.active ? s.label : `${s.label} — architecture ready, not yet activated`}
            className={cn("rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold uppercase", s.active ? "bg-accent-soft text-accent" : "text-dim")}
          >
            {s.label}
          </span>
        ))}
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((g) => (
          <div key={g.group} className="mb-2">
            <div className="label-xs px-3 py-1 text-dim">{g.group}</div>
            {g.items.map((it) => {
              const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "flex h-7 items-center gap-2 border-l-2 px-3 text-[12.5px]",
                    active ? "border-accent bg-accent-soft/40 text-fg" : "border-transparent text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-3 py-2 text-[10px] leading-4 text-dim">
        Analytics tool only. No outcome or profit is guaranteed. Bet responsibly.
      </div>
    </aside>
  );
}
