import Link from "next/link";
import { queryAuditLog } from "@/server/orgs";
import { requireOrg } from "@/server/session";

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const { ctx } = await requireOrg("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const log = await queryAuditLog(ctx, { action: sp.action || undefined, page });
  const pages = Math.max(1, Math.ceil(log.total / log.pageSize));
  const q = (p: number) => `?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), page: String(p) })}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-gray-600">Who changed what, and when. Support access by platform staff is marked.</p>
      <form className="flex flex-wrap gap-2 text-sm">
        <select name="action" defaultValue={sp.action ?? ""} className="input !w-auto"><option value="">All actions</option>{log.actions.map((a) => <option key={a}>{a}</option>)}</select>
        <button className="btn-ghost">Filter</button><span className="self-center text-gray-500">{log.total} events</span>
      </form>
      <div className="card divide-y overflow-x-auto">
        {log.rows.map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm">
            <span className="w-44 text-gray-500">{r.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
            <span className="font-medium">{r.action}</span>
            <span className="text-gray-600">{r.actorEmail ?? "public / system"}</span>
            {r.impersonatorEmail && <span className="rounded bg-amber-100 px-1 text-amber-900">support access by {r.impersonatorEmail}</span>}
            <span className="break-all text-gray-500">{Object.keys(r.meta as object).length ? JSON.stringify(r.meta) : ""}</span>
          </div>
        ))}
      </div>
      <nav className="flex gap-3 text-sm">{page > 1 && <Link className="text-brand-700 underline" href={q(page - 1)}>← Newer</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="text-brand-700 underline" href={q(page + 1)}>Older →</Link>}</nav>
    </div>
  );
}
