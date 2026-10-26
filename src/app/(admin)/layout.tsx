/**
 * (admin)/layout.tsx — Admin auth guard + Template B shell
 *
 * Requires event_admin or platform_admin role.
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

const navLinks = [
  { href: "/admin", label: "Admin" },
  { href: "/events", label: "Events" },
];

const sidebarLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/events", label: "Events" },
];

export default async function AdminLayout({ children }: Props) {
  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin");

  const appUser = await resolveAppUser(session);
  const actor = await buildActor(appUser.id);

  // Require at least one admin-capable role assignment
  const isAdmin = actor.assignments.some(
    (a) => a.roleKey === "super_admin" || a.roleKey === "event_admin",
  );

  if (!isAdmin) redirect("/dashboard");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteHeader links={navLinks} />
      <AppShell sidebarLinks={sidebarLinks} sidebarLabel="Admin navigation">
        {children}
      </AppShell>
      <SiteFooter />
    </div>
  );
}
