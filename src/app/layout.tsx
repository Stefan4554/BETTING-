import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "@/components/providers";


export const metadata: Metadata = {
  title: { default: "Betting Edge Pro", template: "%s · Betting Edge Pro" },
  description: "Professional sports betting tracking, bankroll management and quantitative analytics",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0d0f12" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("bep_theme")?.value;
  const t = theme === "light" || theme === "darker" ? theme : "dark";
  return (
    <html lang="en" data-theme={t}>
      <body>
        <Providers>{children}</Providers>
        <Toaster theme={t === "light" ? "light" : "dark"} position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 12 } }} />
      </body>
    </html>
  );
}
