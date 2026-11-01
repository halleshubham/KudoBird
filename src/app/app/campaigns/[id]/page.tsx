import { ActionForm, Field } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { CampaignTabs } from "@/components/Tabs";
import { COUNTRIES } from "@/server/campaigns/countries";
import { getCampaign } from "@/server/campaigns/service";
import { getCampaignStats } from "@/server/certificates/events";
import { env } from "@/server/env";
import { getOrganization } from "@/server/orgs";
import { campaignFormUrl } from "@/server/urls";
import { requireOrg } from "@/server/session";
import { embedSnippets } from "@/lib/embed";
import { updateCampaignAction, updateSettingsAction } from "../actions";

const Check = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>
);

export default async function CampaignOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOrg("campaigns.view");
  const c = await getCampaign(ctx, id);
  const org = await getOrganization(ctx);
  const url = campaignFormUrl(org.slug, c.slug);
  const s = c.settings;
  const snippets = embedSnippets(env().APP_URL, org.slug, c.slug);
  const stats = await getCampaignStats(ctx, id);
  return (
    <div className="space-y-5">
      <PageHeader title={c.name} action={<Badge tone={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "neutral"}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>} />
      <CampaignTabs id={id} active="overview" />
      <div className="card flex flex-wrap items-center gap-3 text-sm">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Public form link</h2>
          <p className="break-all text-brand-700">{url}</p>
          <p className="text-neutral-600">{c.status === "ACTIVE" ? "Live: anyone with the link can submit." : "Not accepting entries yet. Set the status to Active in the Campaign card below."}</p>
        </div>
        <CopyButton text={url} />
        <a href={url} target="_blank" rel="noreferrer" className="btn-ghost">Open form<span className="sr-only"> (opens in a new tab)</span></a>
      </div>
      {s.embedOrigins.length > 0 && (
        <details className="card text-sm"><summary className="cursor-pointer font-semibold">Embed code</summary>
          <p className="mt-2 text-xs text-neutral-600">Resizes to fit the form (works only on the sites listed under “Sharing and embedding”).</p>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-xs">{snippets.script}</pre>
          <p className="mt-2 text-xs text-neutral-600">Or a plain iframe:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-xs">{snippets.iframe}</pre></details>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[["Certificates", stats.certificates], ["Page views", stats.views], ["Share clicks", stats.shares], ["Pending approval", stats.entries.PENDING ?? 0]].map(([k, v]) => (
          <div key={k} className="card"><p className="text-xs uppercase tracking-wide text-neutral-500">{k}</p><p className="text-2xl font-semibold">{v}</p></div>
        ))}
        {Object.keys(stats.sharesByPlatform).length > 0 && (
          <div className="card col-span-2 sm:col-span-4"><p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Shares by platform</p>
            <p>{Object.entries(stats.sharesByPlatform).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p></div>
        )}
      </div>
      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Campaign</h2>
          <ActionForm action={updateCampaignAction} submit="Save changes" pendingLabel="Saving…">
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
          <h2 className="mb-3 font-semibold">Form behaviour</h2>
          <ActionForm action={updateSettingsAction} submit="Save settings" pendingLabel="Saving…">
            <input type="hidden" name="id" value={id} />
            <fieldset><legend className="label">Languages offered on the form</legend>
              <div className="flex gap-4">{(["mr", "hi", "en"] as const).map((l) => <Check key={l} name={`lang_${l}`} label={{ mr: "मराठी", hi: "हिन्दी", en: "English" }[l]} checked={s.languages.includes(l)} />)}</div></fieldset>
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
            <details className="rounded-xl border border-black/10 p-3"><summary className="cursor-pointer font-medium">Consent and privacy</summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-neutral-500">Leave the consent texts empty to use the built-in wording in each language.</p>
                {(["mr", "hi", "en"] as const).map((l) => (
                  <Field key={l} name={`consent_${l}`} label={`Custom consent text (${{ mr: "मराठी", hi: "हिन्दी", en: "English" }[l]})`} defaultValue={s.consentText[l] ?? ""} />
                ))}
                <Field name="retentionDays" label="Erase personal data after (days)" type="number" min={30} max={3650} defaultValue={s.retentionDays ?? ""} hint="Leave empty to keep it until you erase it yourself. 30 days minimum." />
              </div>
            </details>
            <details className="rounded-xl border border-black/10 p-3"><summary className="cursor-pointer font-medium">Emails to contributors</summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-neutral-500">Optional wording overrides. You can use {"{{name}}"}, {"{{campaign}}"}, {"{{certificate_no}}"} and {"{{org}}"}. Empty uses the built-in translation.</p>
                {(["mr", "hi", "en"] as const).map((l) => (
                  <fieldset key={l} className="space-y-2"><legend className="label">{{ mr: "मराठी", hi: "हिन्दी", en: "English" }[l]}</legend>
                    <Field name={`certSubject_${l}`} label="Certificate email subject" defaultValue={s.email.certificateSubject[l] ?? ""} />
                    <Field name={`certIntro_${l}`} label="Certificate email intro" defaultValue={s.email.certificateIntro[l] ?? ""} />
                    <Field name={`rejIntro_${l}`} label="Rejection email text" defaultValue={s.email.rejectedIntro[l] ?? ""} />
                  </fieldset>
                ))}
              </div>
            </details>
            <details className="rounded-xl border border-black/10 p-3"><summary className="cursor-pointer font-medium">Sharing and embedding</summary>
              <div className="mt-3 space-y-3">
            <div><label className="label" htmlFor="embedOrigins">Websites allowed to show this form (one per line)</label>
              <textarea id="embedOrigins" name="embedOrigins" rows={2} className="input font-mono text-xs" placeholder="https://www.myngo.org" defaultValue={s.embedOrigins.join("\n")} />
              <p className="mt-1 text-xs text-neutral-500">Empty means nobody can embed it. Use the site address only (no path), starting with https://.</p></div>
            <Field name="shareText" label="Share text" defaultValue={s.shareText} hint="You can use {{campaign}}, {{url}} and {{name}}." />
            <Field name="hashtags" label="Hashtags" defaultValue={s.hashtags.join(" ")} hint="Separated by spaces, without the # sign." />
              </div>
            </details>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
