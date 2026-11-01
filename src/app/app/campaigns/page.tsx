import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
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
      <h1 className="text-2xl font-bold">Campaigns</h1>
      <div className="card divide-y">
        {campaigns.length === 0 && <p className="text-sm text-neutral-600">No campaigns yet.</p>}
        {campaigns.map((c) => (
          <Link key={c.id} href={`/app/campaigns/${c.id}`} className="flex items-center justify-between py-3 text-sm hover:text-brand-700">
            <span className="font-medium">{c.name}</span>
            <span className="text-neutral-500">{c.status.toLowerCase()} · {c._count.entries} entries</span>
          </Link>
        ))}
      </div>
      {can(role, "campaigns.manage") && (
        <div className="card max-w-md">
          <p className="mb-3 text-sm font-semibold">New campaign</p>
          <ActionForm action={createCampaignAction} submit="Create campaign">
            <Field name="name" label="Campaign name" required />
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
            </div>
            <Field name="numberPrefix" label="Certificate number prefix (optional)" placeholder="e.g. SJA" maxLength={8} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}
