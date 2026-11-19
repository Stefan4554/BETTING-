/**
 * Hash router for the browser-only build. App paths such as `/matches/abc?x=1`
 * are stored in the URL hash as `#matches.abc~x=1` (plain hash names only).
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let version = 0;

export function toHash(href: string): string {
  if (/^(https?:|mailto:)/.test(href)) return href;
  const [path = "/", query] = href.split("?");
  const name = path.replace(/^\/+|\/+$/g, "").split("/").map(encodeURIComponent).join(".") || "overview";
  return `#${name}${query ? `~${query}` : ""}`;
}

export function fromHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.replace(/^#/, "");
  const [name = "", query = ""] = raw.split("~");
  const path = !name || name === "overview" ? "/" : "/" + name.split(".").map((s) => decodeURIComponent(s)).join("/");
  return { path, query: new URLSearchParams(query) };
}

function emit() {
  version++;
  listeners.forEach((l) => l());
}
if (typeof window !== "undefined") window.addEventListener("hashchange", emit);

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getVersion = () => version;
export const currentHash = () => (typeof window === "undefined" ? "" : window.location.hash);

export function navigate(href: string, replace = false) {
  const h = toHash(href);
  if (replace) {
    history.replaceState(null, "", h);
    emit();
  } else if (window.location.hash === h) emit();
  else window.location.hash = h;
  document.querySelector("main")?.scrollTo({ top: 0 });
}
export const refresh = emit;

export function useLocation() {
  const hash = useSyncExternalStore(subscribe, currentHash, () => "");
  const v = useSyncExternalStore(subscribe, getVersion, () => 0);
  return { ...fromHash(hash), version: v };
}
