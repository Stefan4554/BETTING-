import {
  Activity, BarChart3, Bell, BookOpen, CalendarClock, Gauge, LineChart, ListChecks, Radio, Scale, Settings, Sigma,
  Target, Trophy, Users, Wallet, Webhook, TrendingUp,
} from "lucide-react";

export const NAV = [
  {
    group: "Markets",
    items: [
      { href: "/", label: "Overview", icon: Gauge },
      { href: "/live", label: "Live matches", icon: Radio },
      { href: "/upcoming", label: "Upcoming", icon: CalendarClock },
      { href: "/lines", label: "Lines board", icon: ListChecks },
      { href: "/odds", label: "Odds comparison", icon: Scale },
      { href: "/movement", label: "Odds movement", icon: LineChart },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { href: "/value", label: "Value bets", icon: Target },
      { href: "/predictions", label: "Predictions", icon: Sigma },
      { href: "/analytics", label: "Tennis analytics", icon: Activity },
      { href: "/players", label: "Players", icon: Users },
      { href: "/tournaments", label: "Tournaments", icon: Trophy },
    ],
  },
  {
    group: "Portfolio",
    items: [
      { href: "/tracker", label: "Betting tracker", icon: BookOpen },
      { href: "/bankroll", label: "Bankroll", icon: Wallet },
      { href: "/performance", label: "Performance", icon: TrendingUp },
      { href: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/api-management", label: "API management", icon: Webhook },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

export const SPORTS = [
  { key: "tennis", label: "Tennis", active: true },
  { key: "football", label: "Football", active: false },
  { key: "basketball", label: "Basketball", active: false },
  { key: "ice_hockey", label: "Ice hockey", active: false },
] as const;

export { BarChart3 };
