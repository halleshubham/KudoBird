"use client";
import { useEffect, useState } from "react";
import { platformHref, shareText, shareUrl, type LinkPlatform } from "@/lib/share-links";

export interface ShareLabels { share: string; native: string; copy: string; copied: string; instagram: string; instagramHint: string; whatsapp: string; facebook: string; x: string; linkedin: string; telegram: string }

function track(publicId: string, type: "VIEW" | "SHARE", platform: string) {
  const body = JSON.stringify({ type, platform });
  if (navigator.sendBeacon) navigator.sendBeacon(`/api/c/${publicId}/event`, new Blob([body], { type: "application/json" }));
  else fetch(`/api/c/${publicId}/event`, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
}

/** Counts one page view per browser session (crawlers do not run JS, so link previews are not counted). */
export function ViewBeacon({ publicId, source }: { publicId: string; source?: string }) {
  useEffect(() => {
    try { if (sessionStorage.getItem(`v:${publicId}`)) return; sessionStorage.setItem(`v:${publicId}`, "1"); } catch { /* storage blocked: count anyway */ }
    track(publicId, "VIEW", source ?? "direct");
  }, [publicId, source]);
  return null;
}

export function ShareBar({ publicId, origin, template, hashtags, imageUrl, filename, labels }: {
  publicId: string; origin: string; template: string; hashtags: string[]; imageUrl: string; filename: string; labels: ShareLabels;
}) {
  const [canNative, setCanNative] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => { setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);

  const input = { origin, publicId, template, hashtags };
  const urlFor = (p: string) => shareUrl(input, p);
  const textFor = (p: string) => shareText(input, p);
  const open = (p: string, href: string) => { track(publicId, "SHARE", p); window.open(href, "_blank", "noopener,noreferrer"); };
  const go = (p: LinkPlatform) => open(p, platformHref(input, p));

  async function nativeShare() {
    track(publicId, "SHARE", "native");
    try {
      const blob = await fetch(imageUrl).then((r) => r.blob());
      const file = new File([blob], filename, { type: "image/png" });
      // Sharing the image file itself is what makes Instagram / WhatsApp Status available on phones.
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: textFor("native") });
      else await navigator.share({ text: textFor("native"), url: urlFor("native") });
    } catch { /* user cancelled */ }
  }
  async function copy() {
    track(publicId, "SHARE", "copy");
    try { await navigator.clipboard.writeText(urlFor("copy")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("", urlFor("copy")); }
  }
  function instagram() {
    track(publicId, "SHARE", "instagram");
    const a = document.createElement("a"); a.href = imageUrl; a.download = filename; a.click();
    setHint(true);
  }

  const btn = "btn-ghost !px-3 !py-2 text-sm";
  return (
    <section aria-label={labels.share} className="card space-y-3">
      <p className="font-semibold">{labels.share}</p>
      <div className="flex flex-wrap gap-2">
        {canNative && <button type="button" className="btn !px-3 !py-2 text-sm" onClick={nativeShare}>{labels.native}</button>}
        <button type="button" className={btn} onClick={() => go("whatsapp")}>{labels.whatsapp}</button>
        <button type="button" className={btn} onClick={() => go("facebook")}>{labels.facebook}</button>
        <button type="button" className={btn} onClick={() => go("x")}>{labels.x}</button>
        <button type="button" className={btn} onClick={() => go("linkedin")}>{labels.linkedin}</button>
        <button type="button" className={btn} onClick={() => go("telegram")}>{labels.telegram}</button>
        <button type="button" className={btn} onClick={instagram}>{labels.instagram}</button>
        <button type="button" className={btn} onClick={copy}>{copied ? labels.copied : labels.copy}</button>
      </div>
      {hint && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">{labels.instagramHint}</p>}
    </section>
  );
}
