import {
  Activity, BarChart3, BookOpen, Building2, Calculator, FileText, Gauge, Landmark, LayoutDashboard, LineChart, ListChecks, Settings, ShieldAlert, Target, Trophy,
} from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/bets", label: "Bet Tracker", icon: ListChecks },
  { href: "/live", label: "Live Trading", icon: Activity },
  { href: "/odds", label: "Odds Monitor", icon: LineChart },
  { href: "/bankroll", label: "Bankroll Manager", icon: Landmark },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/clv", label: "CLV Intelligence", icon: Target },
  { href: "/staking", label: "Staking Calculator", icon: Calculator },
  { href: "/sports", label: "Sports Analytics", icon: Trophy },
  { href: "/strategies", label: "Strategy Manager", icon: BookOpen },
  { href: "/risk", label: "Risk Management", icon: ShieldAlert },
  { href: "/bookmakers", label: "Bookmakers", icon: Building2 },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export const GaugeIcon = Gauge;
