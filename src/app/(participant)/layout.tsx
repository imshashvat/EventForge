/**
 * (participant)/layout.tsx — Auth guard + Template B shell
 *
 * Redirects unauthenticated users to sign-in.
 * Uses SiteHeader + AppShell (sidebar + main) per UI Master Guide Template B.
 */
import { redirect } from "next/navigation";
import { getSessionUser } from "@/core/auth";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AppShell } from "@/components/layout/app-shell";

interface Props {
  children: React.ReactNode;
}

const navLinks = [
  { href: "/events", label: "Events" },
  { href: "/dashboard", label: "Dashboard" },
];

const sidebarLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/events", label: "Browse Events" },
];

export default async function ParticipantLayout({ children }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=/dashboard");

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
