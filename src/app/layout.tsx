import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const jbm = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jbm" });

export const metadata: Metadata = {
  title: { default: "EDGE INTELLIGENCE", template: "%s · EDGE INTELLIGENCE" },
  description: "Tennis-first sports analytics and betting intelligence terminal",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0a0e14" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${jbm.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
