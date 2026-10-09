"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { describeAuthError } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";

type Mode = "signin" | "signup";

const MIN_PASSWORD = 8;

export function LoginForm() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/documents");
  }, [loading, user, router]);

  const signingUp = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (signingUp && password.length < MIN_PASSWORD) {
      setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (signingUp) {
        const { data, error: failure } = await supabase.auth.signUp({ email, password });
        if (failure) throw failure;
        // Projects that require email confirmation return no session yet.
        if (!data.session) {
          setNotice(`We sent a link to ${email}. Open it to finish creating your account, then sign in.`);
          setMode("signin");
          setPassword("");
        }
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword({ email, password });
        if (failure) throw failure;
      }
    } catch (failure) {
      setError(describeAuthError(failure instanceof Error ? failure.message : String(failure)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="rise w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.03em] text-ink">Library</h1>
        <p className="mt-3 text-muted">Write down what you know, then ask questions about it.</p>

        <form onSubmit={submit} className="mt-10 flex flex-col gap-4" noValidate>
          {notice && (
            <p role="status" className="rounded-md border border-line bg-green-wash px-3.5 py-2.5 text-sm text-green-ink">
              {notice}
            </p>
          )}
          {error && <Alert>{error}</Alert>}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete={signingUp ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={signingUp ? `At least ${MIN_PASSWORD} characters.` : undefined}
          />
          <Button type="submit" variant="primary" busy={busy} className="mt-2 h-10">
            {signingUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted">
          {signingUp ? "Already have an account? " : "New here? "}
          <button
            type="button"
            className="font-medium text-ink underline underline-offset-4 hover:no-underline"
            onClick={() => {
              setMode(signingUp ? "signin" : "signup");
              setError(null);
              setNotice(null);
            }}
          >
            {signingUp ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </main>
  );
}
