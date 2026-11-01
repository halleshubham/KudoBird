import Link from "next/link";
import { currentPeriod, LIMIT_KEYS, usageOverview } from "@/server/entitlements";
import { getDashboard } from "@/server/dashboard";
import { requireOrg } from "@/server/session";
import { ActivityChart } from "./dashboard-parts/ActivityChart";

const LIMIT_LABEL: Record<string, string> = { campaigns: "Campaigns", members: "Members", certificatesPerMonth: "Certificates this month", emailsPerMonth: "Emails this month", storageBytes: "Storage" };
const fmtLimit = (k: string, v: number) => (k === "storageBytes" ? (v >= 1_073_741_824 ? `${(v / 1_073_741_824).toFixed(1)} GB` : `${(v / 1_048_576).toFixed(v < 10_485_760 ? 1 : 0)} MB`) : String(v));
const Tile = ({ label, value, href }: { label: string; value: number | string; href?: string }) => {
  const body = (<><p className="text-xs uppercase tracking-wide text-gray-500">{label}</p><p className="text-2xl font-semibold">{value}</p></>);
  return href ? <Link href={href} className="card block hover:border-brand-500">{body}</Link> : <div className="card">{body}</div>;
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const { ctx } = await requireOrg("stats.view");
  const { forbidden } = await searchParams;
  const [d, meta] = await Promise.all([
    getDashboard(ctx, 30),
    usageOverview(ctx),
  ]);
  const maxShare = Math.max(1, ...d.sharesByPlatform.map((s) => s.count));
  return (
    <div className="space-y-6">
      {forbidden && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">You do not have permission to view that page.</p>}
      <div>
        <h1 className="text-2xl font-bold">{meta.org.name}</h1>
        <p className="text-sm text-gray-600">Plan: {meta.org.plan.name} · public page <Link className="text-brand-700 underline" href={`/o/${meta.org.slug}`} target="_blank">/o/{meta.org.slug}</Link></p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Certificates issued" value={d.totals.certificates} />
        <Tile label="This month" value={d.totals.thisMonth} />
        <Tile label="Pending approval" value={d.totals.pending} href="/app/campaigns" />
        <Tile label="Entries" value={d.totals.entries} />
        <Tile label="Page views" value={d.totals.views} />
        <Tile label="Share clicks" value={d.totals.shares} />
      </div>
      <section className="card space-y-2">
        <h2 className="font-semibold">Certificates issued, last {d.days} days</h2>
        <ActivityChart series={d.series} />
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold">Shares by platform</h2>
          {d.sharesByPlatform.length === 0 ? <p className="text-sm text-gray-500">No shares yet.</p> : (
            <ul className="space-y-1 text-sm">
              {d.sharesByPlatform.map((s) => (
                <li key={s.platform} className="flex items-center gap-2"><span className="w-20 capitalize">{s.platform}</span>
                  <span className="h-2 rounded bg-brand-600" style={{ width: `${(s.count / maxShare) * 60}%`, minWidth: 4 }} /><span className="text-gray-600">{s.count}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Top campaigns</h2>
          {d.topCampaigns.length === 0 ? <p className="text-sm text-gray-500">No campaigns yet.</p> : (
            <table className="w-full text-left text-sm"><thead className="text-xs text-gray-500"><tr><th className="py-1">Campaign</th><th>Certificates</th><th>Views</th><th>Shares</th></tr></thead>
              <tbody>{d.topCampaigns.map((c) => <tr key={c.id} className="border-t"><td className="py-1"><Link className="text-brand-700 underline" href={`/app/campaigns/${c.id}`}>{c.name}</Link></td><td>{c.certificates}</td><td>{c.views}</td><td>{c.shares}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
      <section className="card">
        <h2 className="mb-2 font-semibold">Plan usage ({currentPeriod()})</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {LIMIT_KEYS.map((k) => { const max = meta.limits[k]; return <div key={k}><p className="text-xs uppercase tracking-wide text-gray-500">{LIMIT_LABEL[k]}</p><p className="font-semibold">{fmtLimit(k, meta.usage[k])} <span className="font-normal text-gray-500">/ {max === undefined || max < 0 ? "∞" : fmtLimit(k, max)}</span></p></div>; })}
        </div>
      </section>
    </div>
  );
}
