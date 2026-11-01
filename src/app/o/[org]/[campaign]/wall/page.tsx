import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWall } from "@/server/certificates/events";

type P = { org: string; campaign: string };
export async function generateMetadata({ params }: { params: Promise<P> }): Promise<Metadata> {
  const { org, campaign } = await params;
  const w = await getWall(org, campaign);
  return w ? { title: `${w.campaign.name} · ${w.campaign.org.name}` } : {};
}

/** Public wall: first names/full names exactly as the contributor typed them, opt-in only. No contact details. */
export default async function Wall({ params }: { params: Promise<P> }) {
  const { org, campaign } = await params;
  const w = await getWall(org, campaign);
  if (!w || !w.enabled) notFound();
  return (
    <main lang={w.campaign.locale} className="mx-auto max-w-2xl px-4 py-6" style={{ fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif" }}>
      <p className="text-sm text-neutral-600">{w.campaign.org.name}</p>
      <h1 className="mb-4 text-2xl font-bold">{w.campaign.name}</h1>
      {w.names.length === 0 ? <p className="text-neutral-600">—</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">{w.names.map((n, i) => <li key={i} className="rounded-md border bg-white px-3 py-2">{n}</li>)}</ul>
      )}
      <p className="mt-6 text-sm"><Link href={`/o/${org}/${campaign}`} className="text-brand-700 underline">← {w.campaign.name}</Link></p>
    </main>
  );
}
