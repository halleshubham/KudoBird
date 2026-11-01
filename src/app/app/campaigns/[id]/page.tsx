import { ActionForm, Field } from "@/components/ActionForm";
import { CampaignTabs } from "@/components/Tabs";
import { COUNTRIES } from "@/server/campaigns/countries";
import { getCampaign } from "@/server/campaigns/service";
import { getCampaignStats } from "@/server/certificates/events";
import { env } from "@/server/env";
import { withTenant } from "@/server/db";
import { requireOrg } from "@/server/session";
import { updateCampaignAction, updateSettingsAction } from "../actions";

const Check = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>
);

export default async function CampaignOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOrg("campaigns.view");
  const c = await getCampaign(ctx, id);
  const org = await withTenant(ctx, (tx) => tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }));
  const url = `${env().APP_URL}/o/${org.slug}/${c.slug}`;
  const s = c.settings;
  const stats = await getCampaignStats(ctx, id);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.name}</h1>
      <CampaignTabs id={id} active="overview" />
      <div className="card text-sm">
        <p className="font-semibold">Public form link</p>
        <p className="break-all text-brand-700">{url}</p>
        <p className="text-gray-500">{c.status === "ACTIVE" ? "Live: anyone with the link can submit." : "Set the status to Active to start accepting entries."}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[["Certificates", stats.certificates], ["Page views", stats.views], ["Share clicks", stats.shares], ["Pending approval", stats.entries.PENDING ?? 0]].map(([k, v]) => (
          <div key={k} className="card"><p className="text-xs uppercase tracking-wide text-gray-500">{k}</p><p className="text-2xl font-semibold">{v}</p></div>
        ))}
        {Object.keys(stats.sharesByPlatform).length > 0 && (
          <div className="card col-span-2 sm:col-span-4"><p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Shares by platform</p>
            <p>{Object.entries(stats.sharesByPlatform).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p></div>
        )}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="card">
          <p className="mb-3 text-sm font-semibold">Campaign</p>
          <ActionForm action={updateCampaignAction} submit="Save">
            <input type="hidden" name="id" value={id} />
            <Field name="name" label="Name" defaultValue={c.name} required />
            <Field name="description" label="Description (shown on the form)" defaultValue={c.description ?? ""} />
            <div>
              <label className="label" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={c.status} className="input"><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select>
            </div>
            <div>
              <label className="label" htmlFor="locale">Default language</label>
              <select id="locale" name="locale" defaultValue={c.locale} className="input"><option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="en">English</option></select>
            </div>
            <Field name="numberPrefix" label="Certificate number prefix" defaultValue={c.numberPrefix} maxLength={8} required />
          </ActionForm>
        </div>
        <div className="card">
          <p className="mb-3 text-sm font-semibold">Form behaviour</p>
          <ActionForm action={updateSettingsAction} submit="Save settings">
            <input type="hidden" name="id" value={id} />
            <div className="flex gap-4">{(["mr", "hi", "en"] as const).map((l) => <Check key={l} name={`lang_${l}`} label={l.toUpperCase()} checked={s.languages.includes(l)} />)}</div>
            <div>
              <label className="label" htmlFor="mobileCountry">Mobile number country</label>
              <select id="mobileCountry" name="mobileCountry" defaultValue={s.mobileCountry} className="input">{COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.dial})</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="duplicateMode">If the same mobile submits again</label>
              <select id="duplicateMode" name="duplicateMode" defaultValue={s.duplicateMode} className="input">
                <option value="return_existing">Return the existing certificate</option><option value="block">Block with a message</option><option value="allow">Allow another entry</option>
              </select>
            </div>
            <Check name="approvalMode" label="Require approval before a certificate is issued" checked={s.approvalMode} />
            <Check name="consentRequired" label="Require consent checkbox" checked={s.consentRequired} />
            <Check name="captcha" label="Bot protection (Cloudflare Turnstile)" checked={s.captcha} />
            <Check name="otpEnabled" label="Verify mobile by OTP" checked={s.otpEnabled} />
            <Check name="wallEnabled" label="Offer a public contributors wall (opt-in)" checked={s.wallEnabled} />
            {(["mr", "hi", "en"] as const).map((l) => (
              <Field key={l} name={`consent_${l}`} label={`Custom consent text (${l.toUpperCase()}), optional`} defaultValue={s.consentText[l] ?? ""} />
            ))}
            <p className="pt-2 text-sm font-semibold">Emails to contributors (optional overrides)</p>
            <p className="text-xs text-gray-500">Use {"{{name}}"}, {"{{campaign}}"}, {"{{certificate_no}}"}, {"{{org}}"}. Leave empty for the built-in translation.</p>
            {(["mr", "hi", "en"] as const).map((l) => (
              <div key={l} className="space-y-2">
                <Field name={`certSubject_${l}`} label={`Certificate email subject (${l.toUpperCase()})`} defaultValue={s.email.certificateSubject[l] ?? ""} />
                <Field name={`certIntro_${l}`} label={`Certificate email intro (${l.toUpperCase()})`} defaultValue={s.email.certificateIntro[l] ?? ""} />
                <Field name={`rejIntro_${l}`} label={`Rejection email text (${l.toUpperCase()})`} defaultValue={s.email.rejectedIntro[l] ?? ""} />
              </div>
            ))}
            <Field name="retentionDays" label="Erase contributors' personal data after (days, empty = keep)" type="number" min={30} max={3650} defaultValue={s.retentionDays ?? ""} />
            <Field name="shareText" label="Share text ({{campaign}}, {{url}}, {{name}})" defaultValue={s.shareText} />
            <Field name="hashtags" label="Hashtags (space separated, no #)" defaultValue={s.hashtags.join(" ")} />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
