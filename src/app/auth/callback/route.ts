import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /auth/callback
 *
 * Supabase redirects here after email confirmation and password reset.
 * Exchanges the ?code= parameter for a session and redirects to the
 * destination specified in the ?next= parameter.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    // cookies() is async in Next.js 16
    const cookieStore = await cookies();
    const supabase = createServerClient(
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Sanitise redirect — only allow relative paths (prevent open redirect)
      const safePath = next.startsWith("/") ? next : "/";
      url.pathname = safePath;
      url.searchParams.delete("code");
      url.searchParams.delete("next");
      return NextResponse.redirect(url);
    }
  }

  // Error or missing code → redirect to sign-in with error message
  url.pathname = "/sign-in";
  url.searchParams.set(
    "error",
    "Authentication link is invalid or has expired. Please try again.",
  );
  url.searchParams.delete("code");
  url.searchParams.delete("next");
  return NextResponse.redirect(url);
}
