"use client";

import { useState, useTransition } from "react";
import { signUp } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, FormField, AlertBanner } from "@/components/ui/input";

export default function SignUpForm() {
  const [state, setState] = useState<{ error?: string; success?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState(null);
    const data = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await signUp(data);
      setState(result);
    });
  }

  if (state?.success) {
    return (
      <div className="text-center py-4 flex flex-col items-center gap-3">
        {/* Success checkmark */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: "var(--success-dim)",
            border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)",
          }}
        >
          <svg
            className="w-6 h-6"
            style={{ color: "var(--success)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-semibold" style={{ color: "var(--success)" }}>
          {state.success}
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Check your inbox and spam folder.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" id="sign-up-form">
      {state?.error && (
        <AlertBanner type="error">{state.error}</AlertBanner>
      )}

      <FormField id="display_name" label="Full name" required>
        <Input
          id="display_name"
          name="display_name"
          type="text"
          autoComplete="name"
          required
          maxLength={80}
          placeholder="Arjun Sharma"
          error={!!state?.error}
        />
      </FormField>

      <FormField id="su-email" label="Email address" required>
        <Input
          id="su-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          error={!!state?.error}
        />
      </FormField>

      <FormField
        id="su-password"
        label="Password"
        required
        hint="Minimum 8 characters"
      >
        <Input
          id="su-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Min. 8 characters"
          error={!!state?.error}
        />
      </FormField>

      <Button
        id="sign-up-submit"
        type="submit"
        loading={isPending}
        loadingText="Creating account…"
        className="w-full"
      >
        Create account
      </Button>

      <p className="text-center text-xs" style={{ color: "var(--text-disabled)" }}>
        By signing up you agree to EventForge&apos;s terms of service.
      </p>
    </form>
  );
}
