import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MESSAGES, t } from "@/i18n/messages";
import { getPublicCampaign } from "@/server/campaigns/public";
import { dialCode } from "@/server/campaigns/validation";
import { fieldLabel } from "@/server/campaigns/validation";
import { PublicForm } from "./PublicForm";

type Params = { org: string; campaign: string };
const NAMES = { mr: "मराठी", hi: "हिन्दी", en: "English" } as const;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, campaign } = await params;
  const c = await getPublicCampaign(org, campaign);
  return c ? { title: `${c.name} · ${c.org.name}`, description: c.description ?? undefined } : {};
}

export default async function PublicCampaignPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ lang?: string }> }) {
  const { org, campaign } = await params;
  const c = await getPublicCampaign(org, campaign);
  if (!c) notFound();
  const { lang: want } = await searchParams;
  const lang = (want && c.settings.languages.includes(want as "mr") ? want : c.locale in MESSAGES ? c.locale : "en") as keyof typeof MESSAGES;
  const m = t(lang);
  return (
    <main lang={lang} className="mx-auto max-w-md px-4 py-6" style={{ fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif" }}>
      <header className="mb-5 space-y-1">
        <p className="text-sm text-neutral-600">{c.org.name}</p>
        <h1 className="text-2xl font-bold leading-snug">{c.name}</h1>
        {c.description && <p className="text-neutral-700">{c.description}</p>}
        {c.settings.languages.length > 1 && (
          <nav aria-label={m.language} className="flex gap-3 pt-2 text-sm">
            {c.settings.languages.map((l) => (
              <Link key={l} href={`?lang=${l}`} className={l === lang ? "font-bold underline" : "text-neutral-600"} prefetch={false}>{NAMES[l]}</Link>
            ))}
          </nav>
        )}
      </header>
      {c.status !== "ACTIVE" ? <p className="rounded-md bg-amber-50 p-3">{m.closed}</p> : (
        <PublicForm
          org={org} campaign={campaign} lang={lang} dial={dialCode(c.settings)} otp={c.settings.otpEnabled}
          fields={c.fields.map((f) => ({ key: f.key, label: fieldLabel(f, lang), type: f.type, required: f.required, options: f.options }))}
          consentRequired={c.settings.consentRequired} consentText={c.settings.consentText[lang] || m.consent}
          purposeText={c.settings.purposeText[lang] || m.purpose}
          wall={c.settings.wallEnabled} captchaSiteKey={c.settings.captcha ? process.env.TURNSTILE_SITE_KEY : undefined}
          accent={c.org.primaryColor ?? "#7c3aed"}
        />
      )}
    </main>
  );
}
