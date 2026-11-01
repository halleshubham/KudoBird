import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { listOrgs } from "@/server/admin/orgs";
import { listPlans } from "@/server/admin/content";
import { requireSuperAdmin } from "@/server/session";
import { createOrgAction } from "../actions";
import { fmtBytes } from "../page";

export default async function AdminOrgs({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const admin = await requireSuperAdmin();
  const sp = await searchParams;
  const status = sp.status === "ACTIVE" || sp.status === "SUSPENDED" || sp.status === "DELETED" ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, plans] = await Promise.all([listOrgs(admin.id, { q: sp.q, status, page }), listPlans(admin.id)]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const q = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Organisations</h1>
      <form className="flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Search name or address" className="input !w-64" />
        <select name="status" defaultValue={status ?? ""} className="input !w-auto"><option value="">All (not deleted)</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DELETED">Deleted</option></select>
        <button className="btn-ghost">Filter</button><span className="self-center text-neutral-500">{list.total} organisations</span>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500"><tr><th className="py-1">Name</th><th>Plan</th><th>Status</th><th>Members</th><th>Campaigns</th><th>Certificates (month / all)</th><th>Storage</th><th>Created</th></tr></thead>
          <tbody>{list.rows.map((o) => (
            <tr key={o.id} className="border-t"><td className="py-1"><Link className="text-brand-700 underline" href={`/admin/orgs/${o.id}`}>{o.name}</Link><span className="block text-xs text-neutral-500">/o/{o.slug}</span></td>
              <td>{o.plan.name}</td><td><span className={`rounded px-2 py-0.5 text-xs ${o.deletedAt ? "bg-neutral-200" : o.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{o.deletedAt ? "deleted" : o.status.toLowerCase()}</span></td>
              <td>{o.members}</td><td>{o.campaigns}</td><td>{o.certificatesThisMonth} / {o.certificates}</td><td>{fmtBytes(o.storageBytes)}</td><td>{o.createdAt.toISOString().slice(0, 10)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <nav className="flex gap-3 text-sm">{page > 1 && <Link className="text-brand-700 underline" href={q(page - 1)}>← Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="text-brand-700 underline" href={q(page + 1)}>Next →</Link>}</nav>
      <div className="card max-w-md">
        <p className="mb-3 text-sm font-semibold">Create an organisation</p>
        <ActionForm action={createOrgAction} submit="Create organisation">
          <Field name="name" label="Organisation name" required />
          <Field name="ownerEmail" label="Owner's email (existing users become owner immediately; others get an invitation)" type="email" required />
          <div><label className="label" htmlFor="planKey">Plan</label><select id="planKey" name="planKey" className="input"><option value="">Platform default</option>{plans.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></div>
        </ActionForm>
      </div>
    </div>
  );
}
