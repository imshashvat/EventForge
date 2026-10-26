import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Security headers ─────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking protection
          { key: "X-Frame-Options", value: "DENY" },
          // MIME sniffing protection
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions policy — disable unneeded browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Content Security Policy
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Scripts: self + Next.js inline scripts
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Styles: self + Google Fonts
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Fonts: self + Google Fonts CDN
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + data URIs + Supabase storage
              "img-src 'self' data: https://*.supabase.co https://*.supabase.in",
              // Connect: self + Supabase + Upstash
              "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.upstash.io https://api.resend.com",
              // Frame ancestors: deny
              "frame-ancestors 'none'",
              // Upgrade insecure requests in production
              process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
            ]
              .filter(Boolean)
              .join("; "),
          },
          // HSTS — only in production
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
      // API routes — no caching by default
      {
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;

