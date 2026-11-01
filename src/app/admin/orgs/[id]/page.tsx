import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { ActionForm } from "@/components/ActionForm";
import { getOrgDetail } from "@/server/admin/orgs";
import { AdminError } from "@/server/admin/guard";
import { currentPeriod, effectiveEntitlements, FEATURE_KEYS, LIMIT_KEYS } from "@/server/entitlements";
import { requireSuperAdmin } from "@/server/session";
import { deleteOrgAction, purgeOrgAction, restoreOrgAction, setOverridesAction, setPlanAction, startSupportAction, suspendAction, unsuspendAction } from "../../actions";
import { fmtBytes } from "../../page";

const USAGE: Record<string, string> = { campaigns: "", members: "", certificatesPerMonth: "certificates_issued", emailsPerMonth: "emails_sent", storageBytes: "storage_bytes" };

export default async function AdminOrg({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireSuperAdmin();
  const { id } = await params;
  let d;
  try { d = await getOrgDetail(admin.id, id); } catch (e) { if (e instanceof AdminError) notFound(); throw e; }
  const { org, members } = d;
  const ov = (org.limitOverrides ?? {}) as { limits?: Record<string, number>; features?: Record<string, boolean> };
  const eff = effectiveEntitlements(org.plan, org.limitOverrides);
  const deleted = !!org.deletedAt;
  return (
    <div className="space-y-6">
      <div><Link href="/admin/orgs" className="text-sm text-brand-700 underline">← Organisations</Link>
        <h1 className="text-2xl font-bold">{org.name} <span className={`ml-2 rounded px-2 py-0.5 align-middle text-xs ${deleted ? "bg-gray-200" : org.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{deleted ? "deleted" : org.status.toLowerCase()}</span></h1>
        <p className="text-sm text-gray-600">/o/{org.slug} · created {org.createdAt.toISOString().slice(0, 10)} · plan {org.plan.name}</p></div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Plan and limits</h2>
          <ActionForm action={setPlanAction} submit="Change plan"><input type="hidden" name="id" value={org.id} />
            <select name="planKey" defaultValue={org.plan.key} className="input">{d.plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></ActionForm>
          <ActionForm action={setOverridesAction} submit="Save overrides"><input type="hidden" name="id" value={org.id} />
            <p className="text-xs text-gray-500">Overrides apply on top of the plan for this organisation only. Empty = use the plan value. -1 = unlimited.</p>
            <table className="w-full text-sm"><thead className="text-xs text-gray-500"><tr><th className="text-left">Limit</th><th>Used</th><th>Plan</th><th>Override</th></tr></thead><tbody>
              {LIMIT_KEYS.map((k) => { const metric = USAGE[k]; const used = k === "campaigns" ? d.campaigns : k === "members" ? members.length : metric ? d.usage[metric] ?? 0 : null; const fmt = (v: number | undefined) => v === undefined ? "∞" : v < 0 ? "∞" : k === "storageBytes" ? fmtBytes(v) : String(v);
                return <tr key={k} className="border-t"><td className="py-1">{k}</td><td className="text-center">{used === null ? "—" : k === "storageBytes" ? fmtBytes(used) : used}</td><td className="text-center text-gray-500">{fmt((org.plan.limits as Record<string, number>)[k])}</td>
                  <td><input name={`limit_${k}`} type="number" min={-1} defaultValue={ov.limits?.[k] ?? ""} className="input !py-1" aria-label={`${k} override`} /></td></tr>; })}
            </tbody></table>
            <div className="grid grid-cols-2 gap-2 text-sm">{FEATURE_KEYS.map((k) => (
              <label key={k} className="flex items-center justify-between gap-2">{k}<select name={`feature_${k}`} defaultValue={ov.features?.[k] === undefined ? "inherit" : ov.features[k] ? "on" : "off"} className="input !w-auto !py-1">
                <option value="inherit">plan ({(org.plan.features as Record<string, boolean>)[k] ? "on" : "off"})</option><option value="on">on</option><option value="off">off</option></select></label>))}</div>
            <p className="text-xs text-gray-500">Effective now: {Object.entries(eff.features).filter(([, v]) => v).map(([k]) => k).join(", ") || "no optional features"} · period {currentPeriod()}</p>
          </ActionForm>
        </section>

        <section className="card space-y-3 text-sm">
          <h2 className="font-semibold">Lifecycle</h2>
          {!deleted && org.status === "ACTIVE" && <ActionButton action={suspendAction} fields={{ id: org.id }} label="Suspend" confirm="Suspend this organisation? Its members lose access and its public forms stop accepting entries (issued certificates stay verifiable).">
            <input name="reason" placeholder="Reason (kept in audit log)" className="input !w-56 !py-1" /></ActionButton>}
          {!deleted && org.status === "SUSPENDED" && <ActionButton action={unsuspendAction} fields={{ id: org.id }} label="Reactivate" />}
          {!deleted && <div><ActionButton action={deleteOrgAction} fields={{ id: org.id }} label="Delete organisation" danger confirm="Delete this organisation? It disappears for everyone, but can be restored until it is purged." /></div>}
          {deleted && (<>
            <ActionButton action={restoreOrgAction} fields={{ id: org.id }} label="Restore organisation" />
            <div className="rounded border border-red-200 bg-red-50 p-3"><p className="mb-2 font-medium text-red-800">Purge permanently</p>
              <p className="mb-2 text-xs text-red-800">Erases the organisation, all its campaigns, entries, certificates and files. This cannot be undone.</p>
              <ActionButton action={purgeOrgAction} fields={{ id: org.id }} label="Purge forever" danger><input name="confirm" placeholder={`Type “${org.slug}” to confirm`} className="input !w-56 !py-1" /></ActionButton></div></>)}
          <div className="border-t pt-3"><h3 className="mb-1 font-semibold">Support access log (also visible to the organisation)</h3>
            {d.impersonations.length === 0 ? <p className="text-gray-500">None.</p> : <ul className="space-y-1 text-xs">{d.impersonations.map((i) => <li key={i.id}>{i.startedAt.toISOString().slice(0, 16).replace("T", " ")} · {i.adminEmail} as {i.targetEmail} · {i.endedAt ? "ended" : "open/expired"} · “{i.reason}”</li>)}</ul>}</div>
        </section>
      </div>

      <section className="card text-sm">
        <h2 className="mb-2 font-semibold">Members ({members.length}) and support access</h2>
        <p className="mb-2 text-xs text-gray-500">Support access signs you in as that user for up to 60 minutes, limited to this organisation. A reason is required, the organisation&apos;s owners are emailed, and it appears in their audit log.</p>
        <div className="divide-y">{members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-48 flex-1"><p className="font-medium">{m.user.name ?? m.user.email}</p><p className="text-xs text-gray-500">{m.user.email} · {m.role.toLowerCase()}{m.user.disabledAt ? " · disabled" : ""}</p></div>
            {!m.user.isSuperAdmin && !m.user.disabledAt && !deleted && org.status === "ACTIVE" && (
              <ActionButton action={startSupportAction} fields={{ orgId: org.id, userId: m.userId }} label="Support access" confirm={`Sign in as ${m.user.email}? This is logged and the organisation owners are notified.`}>
                <input name="reason" required minLength={10} placeholder="Reason / ticket (min 10 chars)" className="input !w-64 !py-1" /></ActionButton>)}
          </div>))}</div>
      </section>
      <section className="card text-sm"><h2 className="mb-2 font-semibold">Recent activity</h2>
        <ul className="space-y-1 text-xs">{d.audit.map((a) => <li key={a.id}>{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {a.action}{a.impersonatorId ? " · via support access" : ""}</li>)}</ul></section>
    </div>
  );
}
