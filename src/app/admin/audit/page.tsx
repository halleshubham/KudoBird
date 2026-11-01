import Link from "next/link";
import { listAllOrgAudit, listPlatformAudit } from "@/server/admin/content";
import { requireSuperAdmin } from "@/server/session";

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ scope?: string; action?: string; org?: string; page?: string }> }) {
  const admin = await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const scope = sp.scope === "orgs" ? "orgs" : "platform";
  const [platform, orgs] = scope === "platform" ? [await listPlatformAudit(admin.id, { action: sp.action, page }), null] : [null, await listAllOrgAudit(admin.id, { action: sp.action, orgId: sp.org, page })];
  const total = (platform ?? orgs)!.total, size = (platform ?? orgs)!.pageSize;
  const pages = Math.max(1, Math.ceil(total / size));
  const q = (p: number) => `?${new URLSearchParams({ scope, ...(sp.action ? { action: sp.action } : {}), ...(sp.org ? { org: sp.org } : {}), page: String(p) })}`;
  const ts = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit</h1>
      <nav className="flex gap-3 text-sm"><Link href="?scope=platform" className={scope === "platform" ? "font-bold underline" : "text-brand-700"}>Platform actions</Link><Link href="?scope=orgs" className={scope === "orgs" ? "font-bold underline" : "text-brand-700"}>Organisation activity</Link></nav>
      <form className="flex gap-2 text-sm"><input type="hidden" name="scope" value={scope} /><input name="action" defaultValue={sp.action} placeholder="Action prefix, e.g. org." className="input !w-56" />{scope === "orgs" && <input name="org" defaultValue={sp.org} placeholder="Organisation id" className="input !w-72" />}<button className="btn-ghost">Filter</button><span className="self-center text-neutral-500">{total} events</span></form>
      <div className="card divide-y text-sm">
        {platform?.rows.map((r) => <div key={r.id} className="flex flex-wrap gap-x-4 py-2"><span className="w-44 text-neutral-500">{ts(r.createdAt)} UTC</span><span className="font-medium">{r.action}</span><span className="text-neutral-600">{r.actorEmail}</span><span className="break-all text-xs text-neutral-500">{JSON.stringify(r.meta)}</span></div>)}
        {orgs?.rows.map((r) => <div key={r.id} className="flex flex-wrap gap-x-4 py-2"><span className="w-44 text-neutral-500">{ts(r.createdAt)} UTC</span><Link href={`/admin/orgs/${r.orgId}`} className="text-brand-700 underline">{r.orgName}</Link><span className="font-medium">{r.action}</span><span className="text-neutral-600">{r.actorEmail ?? "public / system"}</span>{r.impersonatorEmail && <span className="rounded bg-amber-100 px-1 text-xs text-amber-900">support access by {r.impersonatorEmail}</span>}</div>)}
      </div>
      <nav className="flex gap-3 text-sm">{page > 1 && <Link className="text-brand-700 underline" href={q(page - 1)}>← Newer</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="text-brand-700 underline" href={q(page + 1)}>Older →</Link>}</nav>
    </div>
  );
}
