"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// cookies() is async in Next.js 16 — must be awaited
async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}

// ── Sign In ───────────────────────────────────────────────────────────────────
export async function signIn(formData: FormData): Promise<{ error: string } | never> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Don't reveal whether email exists (R-SEC-04)
    return { error: "Invalid email or password. Please try again." };
  }

  redirect(next.startsWith("/") ? next : "/");
}

// ── Sign Up ───────────────────────────────────────────────────────────────────
export async function signUp(
  formData: FormData,
): Promise<{ error: string } | { success: string } | never> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!email || !password || !displayName) {
    return { error: "All fields are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${process.env["NEXT_PUBLIC_APP_URL"]}/auth/callback`,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      // Obscure existence (R-SEC-04) — send same success message
      return { success: "Check your email for a confirmation link." };
    }
    return { error: "Could not create account. Please try again." };
  }

  return { success: "Check your email for a confirmation link." };
}

// ── Sign Out ──────────────────────────────────────────────────────────────────
export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

// ── Password Reset Request ────────────────────────────────────────────────────
export async function requestPasswordReset(
  formData: FormData,
): Promise<{ error: string } | { success: string }> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  if (!email) return { error: "Email address is required." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env["NEXT_PUBLIC_APP_URL"]}/auth/callback?next=/reset-password`,
  });

  // Always return success — don't reveal whether email exists (R-SEC-04)
  return {
    success: "If an account exists with that email, you'll receive a reset link.",
  };
}
