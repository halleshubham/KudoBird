import { listAuditLog } from "@/server/orgs";
import { requireOrg } from "@/server/session";

export default async function Audit() {
  const { ctx } = await requireOrg("audit.view");
  const rows = await listAuditLog(ctx, 200);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <div className="card divide-y overflow-x-auto">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-4 py-2 text-sm">
            <span className="w-44 text-gray-500">{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</span>
            <span className="font-medium">{r.action}</span>
            {r.impersonatorId && <span className="rounded bg-amber-100 px-1 text-amber-900">via support access</span>}
            <span className="text-gray-500">{JSON.stringify(r.meta)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
