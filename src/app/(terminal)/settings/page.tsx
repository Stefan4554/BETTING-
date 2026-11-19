import { currentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { PageHeader } from "@/components/terminal/primitives";
import { SettingsForm } from "./form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await currentUser().catch(() => null);
  return (
    <>
      <PageHeader title="User settings" description="Staking, model confidence, value thresholds and display preferences." />
      <SettingsForm account={user ? { email: user.email, role: user.role } : null} authEnabled={isSupabaseConfigured()} />
    </>
  );
}
