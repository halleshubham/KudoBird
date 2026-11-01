import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicOrg } from "@/server/public-org";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  const o = await getPublicOrg((await params).org);
  return o ? { title: o.name, description: `Certificates issued by ${o.name}` } : {};
}

export default async function PublicOrgPage({ params }: { params: Promise<{ org: string }> }) {
  const slug = (await params).org;
  const o = await getPublicOrg(slug);
  if (!o) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8" style={{ fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif" }}>
      <header className="mb-6 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {o.hasLogo && <img src={`/o/${o.slug}/logo`} alt="" className="h-16 w-auto" />}
        <h1 className="text-2xl font-bold" style={{ color: o.primaryColor ?? undefined }}>{o.name}</h1>
      </header>
      <ul className="space-y-3">
        {o.campaigns.length === 0 && <li className="text-gray-600">—</li>}
        {o.campaigns.map((c) => (
          <li key={c.slug} className="rounded-lg border bg-white p-4">
            <Link href={`/o/${o.slug}/${c.slug}`} className="font-semibold underline" style={{ color: o.primaryColor ?? undefined }}>{c.name}</Link>
            {c.description && <p className="mt-1 text-sm text-gray-700">{c.description}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
