import { CampaignTabs } from "@/components/Tabs";
import { getCampaign, listEntries } from "@/server/campaigns/service";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { EntryStatus } from "@prisma/client";
import { certificateAction, resendEmailAction, reviewEntryAction } from "../../actions";
import { eraseEntryAction } from "../../bulk-actions";
import { ExportDataButton } from "./ExportDataButton";
import { exportEntryDataAction } from "../../bulk-actions";

export default async function Entries({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, role } = await requireOrg("entries.view");
  const c = await getCampaign(ctx, id);
  const status = sp.status && sp.status in EntryStatus ? (sp.status as EntryStatus) : undefined;
  const { rows, total } = await listEntries(ctx, id, { q: sp.q, status, page: Number(sp.page) || 1 });
  const manage = can(role, "entries.manage");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.name}</h1>
      <CampaignTabs id={id} active="entries" />
      <form className="flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Search by name" className="input !w-auto" />
        <select name="status" defaultValue={sp.status ?? ""} className="input !w-auto"><option value="">All statuses</option>{Object.keys(EntryStatus).map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-ghost">Filter</button>
        <span className="self-center text-neutral-500">{total} entries</span>
        <a className="btn-ghost" href={`/app/campaigns/${id}/entries/export`}>Export CSV (masked)</a>
        {manage && <a className="btn-ghost" href={`/app/campaigns/${id}/entries/export?full=1`} title="Includes full mobile numbers and emails; logged in the audit log">Export CSV (full)</a>}
      </form>
      <div className="card divide-y overflow-x-auto">
        {rows.length === 0 && <p className="text-sm text-neutral-600">No entries yet.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
            <span className="min-w-40 flex-1 font-medium">{r.name}</span>
            <span className="text-neutral-600">{r.mobileMasked}</span>
            <span className="text-neutral-500">{r.emailMasked ?? "—"}</span>
            {r.hasEmail && (
              <span title="Email delivery status" className={`rounded px-2 py-0.5 text-xs ${r.emailStatus === "DELIVERED" ? "bg-green-100 text-green-800" : r.emailStatus === "BOUNCED" || r.emailStatus === "COMPLAINED" || r.emailStatus === "FAILED" ? "bg-red-100 text-red-800" : r.emailStatus === "SUPPRESSED" || r.emailStatus === "SKIPPED" ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-700"}`}>
                email: {(r.emailStatus ?? "pending").toLowerCase()}
              </span>
            )}
            {manage && r.certificate && r.hasEmail && r.certificate.renderStatus === "READY" && (
              <form action={resendEmailAction}><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="certificateId" value={r.certificate.id} /><button className="text-neutral-700">Resend email</button></form>
            )}
            <span className={`rounded px-2 py-0.5 text-xs ${r.status === "APPROVED" ? "bg-green-100 text-green-800" : r.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{r.status.toLowerCase()}</span>
            {r.certificate && (
              <a href={`/c/${r.certificate.publicId}`} target="_blank" className="text-brand-700 underline">{r.certificate.number}</a>
            )}
            {r.certificate?.status === "REVOKED" && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">revoked</span>}
            {r.certificate && r.certificate.renderStatus !== "READY" && <span className="text-xs text-neutral-500">{r.certificate.renderStatus.toLowerCase()}</span>}
            {manage && r.certificate && (
              <form action={certificateAction} className="flex items-center gap-2">
                <input type="hidden" name="campaignId" value={id} /><input type="hidden" name="certificateId" value={r.certificate.id} />
                <label className="flex items-center gap-1 text-xs text-neutral-500"><input type="checkbox" name="latest" value="1" /> latest design</label><button name="op" value="regenerate" className="text-neutral-700">Regenerate</button>
                {r.certificate.status === "ACTIVE"
                  ? <><input name="reason" placeholder="Revoke reason" className="input !w-28 !py-1" /><button name="op" value="revoke" className="text-red-600">Revoke</button></>
                  : <button name="op" value="restore" className="text-green-700">Restore</button>}
              </form>
            )}
            {manage && r.name !== "[erased]" && (
              <span className="flex items-center gap-2">
                <ExportDataButton entryId={r.id} action={exportEntryDataAction} />
                <form action={eraseEntryAction}><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="entryId" value={r.id} /><button className="text-red-600" title="Erase this person's personal data (DPDP request)">Erase data</button></form>
              </span>
            )}
            {manage && r.status !== "APPROVED" && (
              <form action={reviewEntryAction}><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="entryId" value={r.id} /><button name="decision" value="APPROVED" className="text-green-700">Approve</button></form>
            )}
            {manage && r.status !== "REJECTED" && (
              <form action={reviewEntryAction}><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="entryId" value={r.id} /><button name="decision" value="REJECTED" className="text-red-600">Reject</button></form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
