import { navigate, refresh, useLocation } from "./router";

export class NotFoundError extends Error {
  constructor() { super("NEXT_NOT_FOUND"); }
}
export function notFound(): never {
  throw new NotFoundError();
}
export function redirect(href: string): never {
  navigate(href, true);
  throw new NotFoundError();
}
export function usePathname() {
  return useLocation().path;
}
export function useSearchParams() {
  return useLocation().query;
}
export function useRouter() {
  return { push: (h: string) => navigate(h), replace: (h: string) => navigate(h, true), refresh, back: () => history.back(), forward: () => history.forward(), prefetch: () => {} };
}
