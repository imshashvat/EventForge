/**
 * Public leaderboard page — /events/[slug]/leaderboard
 *
 * Server Component shell → renders LeaderboardClient for live polling.
 * ARCHITECTURE.md §15.3: client-side polling with ±20% jitter, back off to 30s
 * after repeated 304s, pauses when tab is hidden. Shows stale banner when >30s old.
 */
import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventBySlug } from "@/modules/events";
import { LeaderboardClient } from "./leaderboard-client";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  return {
    title: event ? `Leaderboard — ${event.name} — EventForge` : "Leaderboard — EventForge",
    description: event ? `Live leaderboard for ${event.name}` : undefined,
  };
}

export default async function LeaderboardPage({ params }: Params) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  return (
    <LeaderboardClient
      eventId={event.id}
      eventName={event.name}
      initialScope="overall"
    />
  );
}
