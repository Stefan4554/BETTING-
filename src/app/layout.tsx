import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "@/components/providers";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const jbm = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jbm" });

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
    <html lang="en" data-theme={t} className={`${plex.variable} ${jbm.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Toaster theme={t === "light" ? "light" : "dark"} position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 12 } }} />
      </body>
    </html>
  );
}
