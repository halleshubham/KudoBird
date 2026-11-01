export interface EmbedSnippets { iframe: string; script: string; url: string }

/** Copy-paste snippets for putting a campaign's form on another website. */
export function embedSnippets(origin: string, org: string, campaign: string, lang?: string): EmbedSnippets {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const url = `${origin}/embed/o/${encodeURIComponent(org)}/${encodeURIComponent(campaign)}${q}`;
  return {
    url,
    iframe: `<iframe src="${url}" title="Certificate form" width="100%" height="760" style="border:0;max-width:480px" loading="lazy"></iframe>`,
    // The script version resizes the frame to fit the form, so there is no inner scrollbar.
    script: `<script src="${origin}/embed.js" data-org="${org}" data-campaign="${campaign}"${lang ? ` data-lang="${lang}"` : ""} async></script>`,
  };
}
