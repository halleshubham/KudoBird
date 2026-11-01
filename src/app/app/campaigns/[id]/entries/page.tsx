import Link from "next/link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CampaignTabs } from "@/components/Tabs";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { getCampaign, listEntries } from "@/server/campaigns/service";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { EntryStatus } from "@prisma/client";
import { certificateAction, resendEmailAction, reviewEntryAction } from "../../actions";
import { eraseEntryAction } from "../../bulk-actions";
import { ExportDataButton } from "./ExportDataButton";
import { exportEntryDataAction } from "../../bulk-actions";

const PAGE_SIZE = 25;

export default async function Entries({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, role } = await requireOrg("entries.view");
  const c = await getCampaign(ctx, id);
  const status = sp.status && sp.status in EntryStatus ? (sp.status as EntryStatus) : undefined;
  const { rows, total } = await listEntries(ctx, id, { q: sp.q, status, page: Number(sp.page) || 1, pageSize: PAGE_SIZE });
  const manage = can(role, "entries.manage");
  const page = Math.max(1, Number(sp.page) || 1);
  const pageHref = (n: number) => `/app/campaigns/${id}/entries?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(n) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title={c.name} />
      <CampaignTabs id={id} active="entries" />
      <form className="flex flex-wrap items-end gap-2 text-sm" role="search">
        <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name" className="input !w-48" /></div>
        <div><label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className="input !w-auto"><option value="">All statuses</option>{Object.keys(EntryStatus).map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
        <button className="btn-ghost">Apply filters</button>
        <span className="ml-auto self-center text-neutral-600" role="status">{total} {total === 1 ? "entry" : "entries"}</span>
        <details className="relative">
          <summary className="btn-ghost cursor-pointer list-none [&::-webkit-details-marker]:hidden">Export ▾</summary>
          <div className="absolute right-0 z-10 mt-1 w-64 space-y-1 rounded-xl border border-black/10 bg-white p-2 shadow-lg">
            <a className="block rounded-lg px-3 py-2 hover:bg-neutral-50" href={`/app/campaigns/${id}/entries/export`}>CSV, contacts masked<span className="block text-xs text-neutral-500">Safe to share</span></a>
            {manage && <a className="block rounded-lg px-3 py-2 hover:bg-neutral-50" href={`/app/campaigns/${id}/entries/export?full=1`}>CSV, full details<span className="block text-xs text-neutral-500">Includes mobile numbers and emails. Logged in the audit log.</span></a>}
          </div>
        </details>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={sp.q || sp.status ? "No entries match these filters" : "No entries yet"}>{sp.q || sp.status ? "Try a different name or status." : "Share the public form link from the Overview tab. Entries appear here as people submit."}</EmptyState>
      ) : (
        <ul className="card divide-y divide-black/10 !p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-neutral-500">{r.mobileMasked}{r.emailMasked ? ` · ${r.emailMasked}` : ""}</p>
              </div>
              <Badge tone={r.status === "APPROVED" ? "green" : r.status === "REJECTED" ? "neutral" : "amber"}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
              {r.certificate?.status === "REVOKED" && <Badge>Revoked</Badge>}
              {r.hasEmail && <Badge tone={r.emailStatus === "DELIVERED" ? "green" : r.emailStatus === "BOUNCED" || r.emailStatus === "COMPLAINED" || r.emailStatus === "FAILED" ? "amber" : "neutral"}>Email {(r.emailStatus ?? "pending").toLowerCase()}</Badge>}
              {r.certificate && <a href={`/c/${r.certificate.publicId}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{r.certificate.number}<span className="sr-only"> (opens in a new tab)</span></a>}
              {r.certificate && r.certificate.renderStatus !== "READY" && <span className="text-xs text-neutral-500">{r.certificate.renderStatus.toLowerCase()}</span>}
              {manage && (
                <details className="relative">
                  <summary aria-label={`Actions for ${r.name}`} className="btn-ghost cursor-pointer list-none !px-3 [&::-webkit-details-marker]:hidden">Actions ▾</summary>
                  <div className="absolute right-0 z-10 mt-1 w-72 space-y-2 rounded-xl border border-black/10 bg-white p-3 shadow-lg">
                    {(
                      <form action={reviewEntryAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="campaignId" value={id} /><input type="hidden" name="entryId" value={r.id} />
                        {r.status !== "APPROVED" && <button name="decision" value="APPROVED" className="btn !py-1">Approve</button>}
                        {r.status !== "REJECTED" && <ConfirmButton name="decision" value="REJECTED" danger className="btn-link-danger" title="Reject this entry?" confirmLabel="Reject" message={`${r.name} will not receive a certificate.`}>Reject</ConfirmButton>}
                      </form>
                    )}
                    {r.certificate && (
                      <form action={certificateAction} className="space-y-2 border-t border-black/10 pt-2">
                        <input type="hidden" name="campaignId" value={id} /><input type="hidden" name="certificateId" value={r.certificate.id} />
                        <label className="flex items-center gap-2 text-xs text-neutral-600"><input type="checkbox" name="latest" value="1" /> Use the latest design</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <button name="op" value="regenerate" className="btn-ghost !py-1">Regenerate</button>
                          {r.certificate.status === "ACTIVE" ? null : <button name="op" value="restore" className="btn-ghost !py-1">Restore</button>}
                        </div>
                        {r.certificate.status === "ACTIVE" && (
                          <div className="flex items-center gap-2">
                            <input name="reason" aria-label="Reason for revoking" placeholder="Reason (optional)" className="input !py-1" />
                            <ConfirmButton name="op" value="revoke" danger className="btn-link-danger" title="Revoke this certificate?" confirmLabel="Revoke" message="The public link will show it as revoked and the verification page will no longer confirm it. You can restore it later.">Revoke</ConfirmButton>
                          </div>
                        )}
                      </form>
                    )}
                    {r.certificate && r.hasEmail && r.certificate.renderStatus === "READY" && (
                      <form action={resendEmailAction} className="border-t border-black/10 pt-2"><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="certificateId" value={r.certificate.id} /><button className="btn-ghost !py-1">Resend email</button></form>
                    )}
                    {r.name !== "[erased]" && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-2">
                        <ExportDataButton entryId={r.id} action={exportEntryDataAction} />
                        <form action={eraseEntryAction}><input type="hidden" name="campaignId" value={id} /><input type="hidden" name="entryId" value={r.id} />
                          <ConfirmButton danger className="btn-link-danger" title="Erase personal data?" confirmLabel="Erase data" message={`${r.name}'s name, mobile number and email are permanently removed. This cannot be undone. The certificate record is kept without personal details.`}>Erase data</ConfirmButton></form>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > PAGE_SIZE && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link className="btn-ghost" href={pageHref(page - 1)}>← Previous</Link> : <span />}
          <span className="text-neutral-600">Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
          {page * PAGE_SIZE < total ? <Link className="btn-ghost" href={pageHref(page + 1)}>Next →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
