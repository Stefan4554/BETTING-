# Running the demo inside Claude

`npm run build:artifact` builds a browser-only copy of the terminal into `artifact/dist/index.html`: one self-contained file that can be published as a Claude artifact or opened locally.

## How it works

- It always runs in **demo mode**, on the fictional demo data set. It contains no keys and makes no network requests (apart from Google Fonts).
- The real pages in `src/app/(terminal)` are bundled unchanged. `artifact/main.tsx` awaits each page component in the browser and renders it inside the real terminal layout.
- `fetch("/api/...")` calls are answered in the browser by the real route handlers from `src/app/api`, so live polling, value filters, search, alerts and the tracker behave as they do in the server app.
- `artifact/shims/` replaces `next/link`, `next/navigation`, `next/server`, `next/headers`, `server-only` and Supabase. Routing uses the URL hash, for example `#matches.<id>` or `#lines~market=totals`.
- Bets, settings and browser-side alert rules are kept in the browser's local storage. CSV export goes through the viewer's save dialog (the artifact's `downloads` capability).
- Tailwind is compiled from `src/app/globals.css` with PostCSS, and the JavaScript is bundled with esbuild.

## Limits

- No live data, sign-in, Supabase sync, cron jobs or email alerts. Those need the deployed Next.js app (see DEPLOYMENT.md).
- The demo data set changes every UTC hour, like the server's demo mode.
