import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { listCampaigns } from "@/server/campaigns/service";
import { PRESET_INFO, PRESETS } from "@/server/render/presets";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { createCampaignAction } from "./actions";

export default async function Campaigns() {
  const { ctx, role } = await requireOrg("campaigns.view");
  const campaigns = await listCampaigns(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Campaigns" description="Each campaign has its own public form, certificate design and entries." />
      {campaigns.length === 0 ? (
        <EmptyState title="Create your first campaign">A campaign is one cause or event you want to thank people for. Fill in the form below and you will get a public link to share.</EmptyState>
      ) : (
        <ul className="card divide-y divide-black/10 !p-0">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/app/campaigns/${c.id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-neutral-50">
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <Badge tone={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "neutral"}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
                <span className="hidden w-24 text-right text-sm text-neutral-500 sm:inline">{c._count.entries} {c._count.entries === 1 ? "entry" : "entries"}</span>
                <span aria-hidden className="text-neutral-400">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {can(role, "campaigns.manage") && (
        <details className="card max-w-xl" open={campaigns.length === 0}>
          <summary className="cursor-pointer font-semibold">New campaign</summary>
          <div className="mt-4">
            <ActionForm action={createCampaignAction} submit="Create campaign" pendingLabel="Creating…">
              <Field name="name" label="Campaign name" required hint="Shown as the heading of the public form and on every certificate." />
              <div>
                <label className="label" htmlFor="locale">Form language</label>
                <select id="locale" name="locale" className="input" defaultValue="mr">
                  <option value="mr">मराठी (Marathi)</option><option value="hi">हिन्दी (Hindi)</option><option value="en">English</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="preset">Starting design</label>
                <select id="preset" name="preset" className="input" defaultValue="festive">
                  {PRESETS.map((p) => <option key={p} value={p}>{PRESET_INFO[p].name}: {PRESET_INFO[p].description}</option>)}
                </select>
                <p className="mt-1 text-xs text-neutral-500">You can change everything in the designer later.</p>
              </div>
              <Field name="numberPrefix" label="Certificate number prefix" placeholder="e.g. SJA" maxLength={8} hint="Optional. Certificates are numbered like SJA-2026-00001." />
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
