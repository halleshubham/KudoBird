import type { Metadata } from "next";
import { appUrl } from "../../../server/urls";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicCertificate as loadPublicCertificate } from "@/server/certificates/public";

// generateMetadata and the page render in the same request and need the same data: query once.
const getPublicCertificate = cache(loadPublicCertificate);
import { env } from "@/server/env";
import { RenderProgress } from "./RenderProgress";
import { ShareBar, ViewBeacon } from "./ShareBar";
import { VIEW_SOURCES } from "@/server/certificates/events";
import { replacePlaceholders } from "@/server/render/placeholders";

const L = {
  en: { valid: "Valid certificate", revoked: "This certificate has been revoked", number: "Certificate no.", issuedTo: "Issued to", by: "Issued by", campaign: "Campaign", date: "Issued on", working: "Preparing your certificate…", failed: "We could not prepare this certificate yet. Please check back shortly.", download: "Download", verify: "Verification",
    share: "Share your certificate", native: "Share…", copy: "Copy link", copied: "Link copied ✓", instagram: "Instagram", instagramHint: "Image saved. Now open Instagram and post it from your gallery.", whatsapp: "WhatsApp", facebook: "Facebook", x: "X", linkedin: "LinkedIn", telegram: "Telegram" },
  hi: { valid: "मान्य प्रमाणपत्र", revoked: "यह प्रमाणपत्र रद्द कर दिया गया है", number: "प्रमाणपत्र क्र.", issuedTo: "प्राप्तकर्ता", by: "जारीकर्ता", campaign: "अभियान", date: "जारी तिथि", working: "आपका प्रमाणपत्र तैयार हो रहा है…", failed: "प्रमाणपत्र अभी तैयार नहीं हो सका। कृपया थोड़ी देर बाद देखें।", download: "डाउनलोड", verify: "सत्यापन",
    share: "अपना प्रमाणपत्र साझा करें", native: "साझा करें…", copy: "लिंक कॉपी करें", copied: "लिंक कॉपी हुआ ✓", instagram: "Instagram", instagramHint: "छवि सहेज ली गई है। अब Instagram खोलें और गैलरी से पोस्ट करें।", whatsapp: "WhatsApp", facebook: "Facebook", x: "X", linkedin: "LinkedIn", telegram: "Telegram" },
  mr: { valid: "वैध प्रमाणपत्र", revoked: "हे प्रमाणपत्र रद्द करण्यात आले आहे", number: "प्रमाणपत्र क्र.", issuedTo: "प्राप्तकर्ता", by: "जारीकर्ता", campaign: "मोहीम", date: "दिनांक", working: "तुमचे प्रमाणपत्र तयार होत आहे…", failed: "प्रमाणपत्र अजून तयार होऊ शकले नाही. कृपया थोड्या वेळाने पहा.", download: "डाउनलोड", verify: "पडताळणी",
    share: "तुमचे प्रमाणपत्र शेअर करा", native: "शेअर करा…", copy: "लिंक कॉपी करा", copied: "लिंक कॉपी केली ✓", instagram: "Instagram", instagramHint: "प्रतिमा सेव्ह झाली आहे. आता Instagram उघडा आणि गॅलरीतून पोस्ट करा.", whatsapp: "WhatsApp", facebook: "Facebook", x: "X", linkedin: "LinkedIn", telegram: "Telegram" },
} as const;
const lbl = (l: string) => L[(l in L ? l : "en") as keyof typeof L];
const abs = (p: string) => appUrl(p);

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const c = await getPublicCertificate((await params).publicId);
  if (!c) return { title: "Certificate not found", robots: { index: false } };
  const title = `${c.name} · ${c.campaign.name}`;
  const description = `${lbl(c.locale).valid}: ${c.number} · ${c.org.name}`;
  const hash = c.outputs.link?.hash;
  const image = hash ? { url: abs(`/c/${c.publicId}/img/link?v=${hash}`), width: 1200, height: 630, alt: title } : undefined;
  return {
    title, description, robots: { index: false, follow: false },
    alternates: { canonical: abs(`/c/${c.publicId}`) },
    openGraph: { type: "website", url: abs(`/c/${c.publicId}`), title, description, siteName: c.org.name, images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image.url] : undefined },
  };
}

export default async function CertificatePage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ s?: string }> }) {
  const c = await getPublicCertificate((await params).publicId);
  if (!c) notFound();
  const { s: src } = await searchParams;
  const source = src && (VIEW_SOURCES as readonly string[]).includes(src) ? src : undefined;
  const t = lbl(c.locale);
  const ready = !!c.outputs.square;
  const revoked = c.status === "REVOKED";
  const shareTemplate = replacePlaceholders(c.campaign.shareText.replaceAll("{{url}}", "\u0000URL\u0000"), { campaign: c.campaign.name, name: c.name, org: c.org.name }).replaceAll("\u0000URL\u0000", "{{url}}");
  return (
    <main lang={c.locale} className="mx-auto max-w-lg space-y-4 px-4 py-6" style={{ fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif" }}>
      <p className={`rounded-md p-3 text-center font-semibold ${revoked ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>{revoked ? `✕ ${t.revoked}` : `✓ ${t.valid}`}</p>
      {ready ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/c/${c.publicId}/img/square?v=${c.outputs.square.hash}`} alt={`${c.name} · ${c.number}`} width={1080} height={1080} className="w-full rounded-lg border bg-white shadow-sm" />
      ) : revoked ? null : <RenderProgress publicId={c.publicId} failed={c.renderStatus === "FAILED"} labels={{ working: t.working, failed: t.failed }} />}
      <section aria-label={t.verify} className="card space-y-1 text-sm">
        <p><span className="text-neutral-500">{t.issuedTo}:</span> <strong>{c.name}</strong></p>
        <p><span className="text-neutral-500">{t.number}:</span> {c.number}</p>
        <p><span className="text-neutral-500">{t.campaign}:</span> {c.campaign.name}</p>
        <p><span className="text-neutral-500">{t.by}:</span> {c.org.name}</p>
        <p><span className="text-neutral-500">{t.date}:</span> {new Intl.DateTimeFormat(c.locale === "en" ? "en-IN" : `${c.locale}-IN`, { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(c.issuedAt)}</p>
      </section>
      <ViewBeacon publicId={c.publicId} source={source} />
      {ready && !revoked && (
        <ShareBar publicId={c.publicId} origin={env().APP_URL} template={shareTemplate} hashtags={c.campaign.hashtags} imageUrl={`/c/${c.publicId}/img/square?v=${c.outputs.square.hash}`} filename={`${c.number}.png`} labels={t} />
      )}
      {ready && (
        <div className="flex flex-wrap gap-2 text-sm">
          {[["square", "PNG 1080×1080"], ["story", "Story 1080×1920"], ["a4", "A4 PNG"], ["pdf", "PDF"]].filter(([k]) => c.outputs[k]).map(([k, label]) => (
            <a key={k} className="btn-ghost" href={`/c/${c.publicId}/img/${k}?download=1&v=${c.outputs[k].hash}`}>{t.download} {label}</a>
          ))}
        </div>
      )}
    </main>
  );
}
