/** Pure builders for share-button targets, shared by the UI and tests. No DOM access. */
export interface ShareInput { origin: string; publicId: string; template: string; hashtags: string[] }

export const shareUrl = (i: ShareInput, platform: string) => `${i.origin}/c/${i.publicId}?s=${platform}`;

const tags = (i: ShareInput) => i.hashtags.map((h) => `#${h}`).join(" ");

/** Full message including the tracked link. If the template has no {{url}} the link is appended. */
export function shareText(i: ShareInput, platform: string): string {
  const url = shareUrl(i, platform);
  const base = i.template.includes("{{url}}") ? i.template.replaceAll("{{url}}", url) : `${i.template} ${url}`;
  return tags(i) ? `${base} ${tags(i)}` : base;
}

/** Message without the link, for platforms that take the URL as a separate field (X, Telegram). */
export function shareTextWithoutUrl(i: ShareInput): string {
  return (i.template.replaceAll("{{url}}", "").replace(/\s+/g, " ").trim() + (tags(i) ? ` ${tags(i)}` : "")).trim();
}

const enc = encodeURIComponent;
export type LinkPlatform = "whatsapp" | "facebook" | "x" | "linkedin" | "telegram";

export function platformHref(i: ShareInput, p: LinkPlatform): string {
  switch (p) {
    case "whatsapp": return `https://wa.me/?text=${enc(shareText(i, p))}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl(i, p))}`;
    case "x": return `https://twitter.com/intent/tweet?text=${enc(shareTextWithoutUrl(i))}&url=${enc(shareUrl(i, p))}`;
    case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl(i, p))}`;
    case "telegram": return `https://t.me/share/url?url=${enc(shareUrl(i, p))}&text=${enc(shareTextWithoutUrl(i))}`;
  }
}
