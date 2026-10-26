/**
 * (public)/layout.tsx — Template C: full nav + footer, no sidebar
 *
 * Used for: events list, event detail, leaderboard.
 * SiteHeader + full-width main + SiteFooter.
 */
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

interface Props {
  children: React.ReactNode;
}

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Events" },
];

export default function PublicLayout({ children }: Props) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteHeader links={navLinks} />
      <main
        id="main"
        tabIndex={-1}
        style={{ flex: 1 }}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
