import Link from "next/link";
import { getPlatformStats } from "@/server/admin/stats";
import { requireSuperAdmin } from "@/server/session";
import { ActivityChart } from "../app/dashboard-parts/ActivityChart";

export const fmtBytes = (n: number) => (n >= 1_073_741_824 ? `${(n / 1_073_741_824).toFixed(1)} GB` : n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const Tile = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <div className="card"><p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p><p className="text-2xl font-semibold">{value}</p>{sub && <p className="text-xs text-neutral-500">{sub}</p>}</div>
);

export default async function AdminHome() {
  const admin = await requireSuperAdmin();
  const s = await getPlatformStats(admin.id, 30);
  const h = s.emailHealth;
  const pct = (n: number) => (h.total ? `${((n / h.total) * 100).toFixed(1)}%` : "0%");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform overview</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Tile label="Active orgs" value={s.orgs.active} sub={`${s.orgs.suspended} suspended · ${s.orgs.deleted} deleted`} />
        <Tile label="Users" value={s.users.total} sub={`${s.users.admins} platform admins`} />
        <Tile label="Certificates" value={s.certificates.total} sub={`${s.certificates.thisMonth} this month`} />
        <Tile label="Entries" value={s.entries.total} sub={`${s.entries.pending} pending approval`} />
        <Tile label="Emails this month" value={s.emailsThisMonth} />
        <Tile label="Storage" value={fmtBytes(s.storageBytes)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card"><h2 className="mb-2 font-semibold">Certificates issued, 30 days</h2><ActivityChart series={s.certificatesPerDay} unit="certificate" /></section>
        <section className="card"><h2 className="mb-2 font-semibold">New users, 30 days</h2><ActivityChart series={s.signupsPerDay} unit="signup" /></section>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Top organisations this month</h2>
          {s.topOrgs.length === 0 ? <p className="text-neutral-500">No certificates yet.</p> : <ul className="space-y-1">{s.topOrgs.map((o) => <li key={o.id} className="flex justify-between"><Link className="text-brand-700 underline" href={`/admin/orgs/${o.id}`}>{o.name}</Link><span>{o.certificates}</span></li>)}</ul>}
          <h3 className="mb-1 mt-4 font-semibold">Orgs by plan</h3><ul>{s.plans.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span>{p.orgs}</span></li>)}</ul></section>
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Email health (30 days, contributor mail)</h2>
          <p>{h.total} sent · {h.delivered} delivered/sent</p>
          <p className={h.bounced + h.complained > 0 ? "text-amber-800" : ""}>Bounced {h.bounced} ({pct(h.bounced)}) · Complaints {h.complained} ({pct(h.complained)})</p>
          <p>Failed {h.failed} · Suppressed {h.suppressed}</p>
          <p className="mt-2 text-xs text-neutral-500">Keep complaints under 0.1% and bounces under 2% to protect the sending domain.</p></section>
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Background jobs</h2>
          {s.queues.ok ? (<><p>Render: {s.queues.render.waiting} waiting · {s.queues.render.active} active · <span className={s.queues.render.failed ? "text-red-700" : ""}>{s.queues.render.failed} failed</span></p>
            <p>Email: {s.queues.email.waiting} waiting · {s.queues.email.active} active · <span className={s.queues.email.failed ? "text-red-700" : ""}>{s.queues.email.failed} failed</span></p></>) : <p className="text-red-700">Queue unreachable (is Redis running?)</p>}
          {s.failedRenders.length > 0 && <div className="mt-2"><p className="font-medium text-red-700">Failed renders</p>{s.failedRenders.map((f) => <p key={f.id} className="truncate text-xs">{f.number}: {f.renderError}</p>)}</div>}</section>
      </div>
    </div>
  );
}
