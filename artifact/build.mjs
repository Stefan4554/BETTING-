// Builds the browser-only demo into artifact/dist/index.html (one self-contained file).
// Usage: node artifact/build.mjs
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shim = (f) => path.join(here, "shims", f);

const css = await postcss([tailwind({ base: root })]).process(
  `@import "tailwindcss" source(none);\n@source "../src";\n@source "./";\n` +
    (await readFile(path.join(root, "src/app/globals.css"), "utf8")).replace('@import "tailwindcss";', ""),
  { from: path.join(here, "styles.css") },
);

const result = await build({
  entryPoints: [path.join(here, "main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  write: false,
  legalComments: "none",
  loader: { ".css": "empty" },
  alias: {
    "@": path.join(root, "src"),
    "server-only": shim("empty.ts"),
    "next/link": shim("next-link.tsx"),
    "next/navigation": shim("next-navigation.ts"),
    "next/server": shim("next-server.ts"),
    "next/headers": shim("next-headers.ts"),
    "@supabase/ssr": shim("supabase.ts"),
    "@supabase/supabase-js": shim("supabase.ts"),
  },
  define: {
    "process.env": JSON.stringify({ NEXT_PUBLIC_DEMO_MODE: "true", NODE_ENV: "production" }),
    "process.env.NODE_ENV": '"production"',
  },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = `<meta charset="utf-8">
<title>Edge Intelligence</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>:root{--font-plex:"IBM Plex Sans";--font-jbm:"JetBrains Mono";color-scheme:dark}html,body{background:#0a0e14;margin:0}
${css.css}</style>
<div id="root"></div>
<script>${js}</script>
`;
await mkdir(path.join(here, "dist"), { recursive: true });
await writeFile(path.join(here, "dist/index.html"), html);
console.log(`artifact/dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
