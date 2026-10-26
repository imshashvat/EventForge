/**
 * (participant)/layout.tsx — Auth guard + Template B shell
 *
 * Redirects unauthenticated users to sign-in.
 * Uses SiteHeader + AppShell (sidebar + main) per UI Master Guide Template B.
 */
import { redirect } from "next/navigation";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AppShell } from "@/components/layout/app-shell";

interface Props {
  children: React.ReactNode;
}

const sidebarLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/events", label: "Browse Events" },
];

export default async function ParticipantLayout({ children }: Props) {
  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/dashboard");

  // Check if user is also an admin
  let isAdmin = false;
  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    isAdmin = actor.assignments.some(
      (a) => a.roleKey === "super_admin" || a.roleKey === "event_admin",
    );
  } catch { /* not provisioned yet */ }

  const navLinks = [
    { href: "/events", label: "Browse Events" },
    { href: "/dashboard", label: "My Events" },
    ...(isAdmin ? [{ href: "/admin/events", label: "Admin Panel" }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteHeader links={navLinks} />
      <AppShell sidebarLinks={sidebarLinks} sidebarLabel="Participant navigation">
        {children}
      </AppShell>
      <SiteFooter />
    </div>
  );
}
