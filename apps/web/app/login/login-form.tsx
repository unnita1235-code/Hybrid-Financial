"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function isSafeNext(next: string | undefined, fallback: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }
  return next;
}

type Props = {
  defaultNext?: string;
};

export function LoginForm({ defaultNext }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [mode, setMode] = useState<"signin" | "register">("signin");

  const next = isSafeNext(defaultNext, "/");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        let message = "Request failed. Try again.";
        try {
          const data = (await res.json()) as { error?: string; detail?: string };
          if (typeof data.error === "string" && data.error) message = data.error;
          else if (typeof data.detail === "string" && data.detail)
            message = data.detail;
        } catch {
          // keep generic message
        }
        setError(message);
        return;
      }
      if (mode === "register") {
        // Registration creates the account without signing in; sign in next.
        setMode("signin");
        setError(null);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Request failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-slate-500">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs font-medium text-slate-500">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
        />
      </div>
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md border border-white/15 bg-zinc-900/80 py-2 text-sm font-medium text-slate-100 transition hover:bg-zinc-800 disabled:opacity-50"
      >
        {submitting
          ? mode === "register"
            ? "Creating account…"
            : "Signing in…"
          : mode === "register"
            ? "Create account"
            : "Sign in"}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={() => {
          setMode(mode === "register" ? "signin" : "register");
          setError(null);
        }}
        className="w-full py-1 text-center text-xs text-slate-500 transition hover:text-slate-300 disabled:opacity-50"
      >
        {mode === "register"
          ? "Already have an account? Sign in"
          : "Need an account? Create one"}
      </button>
    </form>
  );
}
