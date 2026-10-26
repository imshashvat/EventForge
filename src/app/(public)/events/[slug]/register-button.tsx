"use client";

/**
 * Register button client island — keeps the event detail page as a Server Component.
 */
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function RegisterButton({
  eventId,
  isSignedIn,
  slug,
}: {
  eventId: string;
  isSignedIn: boolean;
  slug: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <Button variant="primary" size="sm" asChild>
        <Link href={`/sign-in?next=/events/${slug}`}>Sign in to register</Link>
      </Button>
    );
  }

  async function handleRegister() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setState("done");
        // Reload to show server-side "Registered" badge
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { error?: string }).error ?? "Registration failed");
        setState("error");
      }
    } catch {
      setErrorMsg("Network error — please try again");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <span className="text-sm" style={{ color: "var(--success)" }}>
        ✓ Registered!
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        id="register-btn"
        variant="primary"
        size="sm"
        loading={state === "loading"}
        loadingText="Registering…"
        onClick={() => void handleRegister()}
      >
        Register now
      </Button>
      {state === "error" && errorMsg && (
        <p className="text-xs" style={{ color: "var(--error)" }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}
