import { forwardRef, type AnchorHTMLAttributes } from "react";
import { toHash } from "./router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname: string }; prefetch?: boolean; scroll?: boolean; replace?: boolean };

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch: _p, scroll: _s, replace: _r, ...rest }, ref) {
  const h = typeof href === "string" ? href : href.pathname;
  return <a ref={ref} href={toHash(h)} {...rest} />;
});
export default Link;
