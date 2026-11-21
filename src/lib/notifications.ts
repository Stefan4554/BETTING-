/** Notification types users can route to in-app and/or email (keys = alerts.type). */
export const NOTIFICATION_TYPES = [
  ["bet_settled", "Bet settled"], ["large_profit", "Large profit"], ["large_loss", "Large loss"], ["daily_loss", "Daily loss limit"],
  ["weekly_loss", "Weekly loss limit"], ["drawdown", "Maximum drawdown"], ["odds_movement", "Important odds movement"], ["clv_update", "CLV update"],
  ["api_failure", "API connection failure"], ["exposure", "Risk exposure warning"], ["stake_limit", "Stake limit"], ["goal_progress", "Goal reached"],
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number][0];
/** Mirrors private.notify_pref defaults: everything in-app except bet_settled; email is opt-in. */
export const defaultPref = (t: string) => ({ in_app: t !== "bet_settled", email: false });
