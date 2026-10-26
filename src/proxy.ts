/**
 * Next.js proxy — session refresh + protected route guard (proxy.ts)
 * Runs on every request matching the config.matcher pattern.
 *
 * Responsibilities:
 *  1. Refresh the Supabase session cookie (keeps it alive)
 *  2. Redirect unauthenticated users away from protected routes
 *  3. Redirect authenticated users away from auth pages
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that require authentication
const PROTECTED_PREFIXES = ["/e/", "/admin", "/judge", "/api/v1/"];

// Routes that authenticated users should not see (auth pages)
const AUTH_ONLY_ROUTES = ["/sign-in", "/sign-up", "/forgot-password"];

// Internal API routes (auth handled differently — CRON_SECRET, not session)
const INTERNAL_ROUTES = ["/api/v1/internal/", "/api/health"];

// Public read-only API endpoints (GET only): event list/detail and public leaderboard.
// Each route still enforces its own policy (e.g. leaderboard visibility).
const PUBLIC_API_GET = [
  /^\/api\/v1\/events$/,
  /^\/api\/v1\/events\/[0-9a-f-]{36}$/,
  /^\/api\/v1\/events\/[0-9a-f-]{36}\/leaderboard$/,
];

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  // Skip internal routes — they handle their own auth
  if (INTERNAL_ROUTES.some((p) => pathname.startsWith(p))) {
    return res;
  }

  // Create Supabase client for this request
  const supabase = createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Refresh session — this is the critical step (keeps tokens fresh)
  const { data: { user } } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthOnly = AUTH_ONLY_ROUTES.some((p) => pathname.startsWith(p));

  const isApi = pathname.startsWith("/api/");
  const isPublicApiGet =
    req.method === "GET" && PUBLIC_API_GET.some((re) => re.test(pathname));

  // Unauthenticated API call → 401 JSON (a redirect is meaningless for API clients)
  if (!user && isApi && !isPublicApiGet) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Unauthenticated page → redirect to sign-in
  if (!user && isProtected && !isApi) {
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated → redirect away from sign-in/sign-up
  if (user && isAuthOnly) {
    url.pathname = "/";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml
     * - public assets (images, fonts)
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|otf)).*)",
  ],
};
