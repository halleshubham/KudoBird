import { notFound } from "next/navigation";
import Link from "next/link";
import { MESSAGES, t } from "@/i18n/messages";
import { getPublicCampaign } from "@/server/campaigns/public";
import { dialCode, fieldLabel } from "@/server/campaigns/validation";
import { PublicForm } from "../../../../o/[org]/[campaign]/PublicForm";
import { EmbedResizer } from "./EmbedResizer";

export const metadata = { robots: { index: false, follow: false } };
const NAMES = { mr: "मराठी", hi: "हिन्दी", en: "English" } as const;

/** Compact, chrome-free version of the public form for iframes. Framing is restricted per campaign by the middleware. */
export default async function EmbeddedForm({ params, searchParams }: { params: Promise<{ org: string; campaign: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { org, campaign } = await params;
  const c = await getPublicCampaign(org, campaign);
  if (!c) notFound();
  const { lang: want } = await searchParams;
  const lang = (want && c.settings.languages.includes(want as "mr") ? want : c.locale in MESSAGES ? c.locale : "en") as keyof typeof MESSAGES;
  const m = t(lang);
  return (
    <main lang={lang} className="mx-auto max-w-md px-3 py-3" style={{ fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif" }}>
      <EmbedResizer />
      <h1 className="mb-1 text-xl font-bold leading-snug">{c.name}</h1>
      {c.description && <p className="mb-2 text-neutral-700">{c.description}</p>}
      {c.settings.languages.length > 1 && (
        <nav aria-label={m.language} className="mb-3 flex gap-3 text-sm">{c.settings.languages.map((l) => <Link key={l} href={`?lang=${l}`} prefetch={false} className={l === lang ? "font-bold underline" : "text-neutral-600"}>{NAMES[l]}</Link>)}</nav>
      )}
      {c.status !== "ACTIVE" ? <p className="rounded-md bg-amber-50 p-3">{m.closed}</p> : (
        <PublicForm
          org={org} campaign={campaign} lang={lang} dial={dialCode(c.settings)} otp={c.settings.otpEnabled} linkTarget="_blank"
          fields={c.fields.map((f) => ({ key: f.key, label: fieldLabel(f, lang), type: f.type, required: f.required, options: f.options }))}
          consentRequired={c.settings.consentRequired} consentText={c.settings.consentText[lang] || m.consent} purposeText={c.settings.purposeText[lang] || m.purpose}
          wall={c.settings.wallEnabled} captchaSiteKey={c.settings.captcha ? process.env.TURNSTILE_SITE_KEY : undefined} accent={c.org.primaryColor ?? "#7c3aed"}
        />
      )}
    </main>
  );
}
