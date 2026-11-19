"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabaseBrowser();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const res =
      mode === "magic" ? await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } })
      : mode === "signup" ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
      : await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (res.error) return setMsg({ ok: false, text: res.error.message });
    if (mode === "signin") { router.replace(next); router.refresh(); }
    else setMsg({ ok: true, text: "Check your email for the link." });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label>Email<Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Label>
      {mode !== "magic" && <Label>Password<Input type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Label>}
      <Button type="submit" size="lg" disabled={busy}>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send magic link"}</Button>
      {msg && <p className={`text-xs ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      <div className="flex justify-between text-[11px] text-muted">
        <button type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Have an account? Sign in" : "Create account"}</button>
        <button type="button" onClick={() => setMode(mode === "magic" ? "signin" : "magic")}>{mode === "magic" ? "Use password" : "Email me a link"}</button>
      </div>
    </form>
  );
}
