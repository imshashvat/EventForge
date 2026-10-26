/**
 * (public)/layout.tsx — Template C: full nav + footer, no sidebar
 *
 * Used for: events list, event detail, leaderboard.
 * Shows user-context nav: sign in / dashboard / admin link.
 */
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";

interface Props {
  children: React.ReactNode;
}

export default async function PublicLayout({ children }: Props) {
  const session = await getSessionUser();

  // Build nav based on auth state + role
  const baseLinks = [
    { href: "/events", label: "Browse Events" },
  ];

  let authLinks: { href: string; label: string }[] = [];

  if (session) {
    try {
      const appUser = await resolveAppUser(session);
      const actor = await buildActor(appUser.id);
      const isAdmin = actor.assignments.some(
        (a) => a.roleKey === "super_admin" || a.roleKey === "event_admin",
      );
      authLinks = isAdmin
        ? [{ href: "/admin/events", label: "Admin Panel" }, { href: "/dashboard", label: "My Events" }]
        : [{ href: "/dashboard", label: "My Events" }];
    } catch {
      authLinks = [{ href: "/dashboard", label: "My Events" }];
    }
  } else {
    authLinks = [{ href: "/sign-in", label: "Sign In" }];
  }

  const navLinks = [...baseLinks, ...authLinks];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteHeader links={navLinks} />
      <main id="main" tabIndex={-1} style={{ flex: 1 }}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
