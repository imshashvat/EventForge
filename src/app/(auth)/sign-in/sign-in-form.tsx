"use client";

import { useState, useTransition } from "react";
import { signIn } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, FormField, AlertBanner } from "@/components/ui/input";

interface Props {
  next?: string;
}

export default function SignInForm({ next }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await signIn(data);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" id="sign-in-form">
      {error && (
        <AlertBanner type="error">{error}</AlertBanner>
      )}

      <FormField id="email" label="Email address" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          error={!!error}
        />
      </FormField>

      <FormField id="password" label="Password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          placeholder="••••••••"
          error={!!error}
        />
        <div className="flex justify-end mt-1">
          <a
            href="/forgot-password"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--teal-500)] transition-colors"
          >
            Forgot password?
          </a>
        </div>
      </FormField>

      {next && <input type="hidden" name="next" value={next} />}

      <Button
        id="sign-in-submit"
        type="submit"
        loading={isPending}
        loadingText="Signing in…"
        className="w-full"
      >
        Sign in
      </Button>
    </form>
  );
}
