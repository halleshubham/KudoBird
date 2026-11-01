import type { Design, BlockKey, Block } from "./design";
import { BLOCK_KEYS } from "./design";
import { replacePlaceholders } from "./placeholders";

export interface RenderInput {
  design: Design;
  /** Values for {{placeholders}}: name, campaign, org, date, certificate_no + custom fields. */
  data: Record<string, string | undefined | null>;
  /** Pre-resolved image sources (data URIs or URLs) keyed by Asset id. */
  assets: Record<string, string>;
  signatories: { name: string; designation: string; imageSrc?: string | null }[];
  qrSrc?: string | null;
  size: { w: number; h: number };
  /** @font-face CSS for every font used (see fontFaceCss). */
  fontCss: string;
  revoked?: boolean;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const u = (n: number) => `calc(var(--u) * ${n})`;
const FALLBACK = "'Noto Serif Devanagari','Noto Sans Devanagari',serif";

function blockHtml(key: BlockKey, b: Block, data: RenderInput["data"]): string {
  if (!b.show) return "";
  const text = esc(replacePlaceholders(b.text, data)).replace(/\n/g, "<br>");
  if (!text.trim()) return "";
  // line-height is generous: Devanagari matras and reph extend above/below the line box.
  return `<div class="b-${key}" style="font-family:'${esc(b.font)}',${FALLBACK};font-size:${u(b.size)};font-weight:${b.weight};text-align:${b.align};color:${b.color};font-style:${b.italic ? "italic" : "normal"};line-height:1.45;">${text}</div>`;
}

function borderCss(d: Design["border"]): string {
  if (d.style === "none" || d.width === 0) return "";
  const inset = u(d.inset);
  const w = u(d.width);
  if (d.style === "solid") return `.frame{position:absolute;inset:${inset};border:${w} solid ${d.color};}`;
  if (d.style === "double") return `.frame{position:absolute;inset:${inset};border:${u(d.width * 3.2)} double ${d.color};}`;
  return `.frame{position:absolute;inset:${inset};border:${w} solid ${d.color};border-radius:${u(1.6)};box-shadow:0 0 0 ${u(0.5)} #fff7e6, 0 0 0 ${u(0.9)} ${d.color};}
.frame:after{content:"";position:absolute;inset:${u(1.2)};border:${u(0.25)} dashed ${d.color};border-radius:${u(1)};}`;
}

/**
 * Pure function: design + data -> a complete, self-contained HTML document.
 * Used by the live preview and by the Chromium render worker, so what you see is what is issued.
 * Layout is a flex column (not absolute positions) so it adapts to every output aspect ratio.
 */
export function renderCertificateHtml(input: RenderInput): string {
  const { design: d, data, assets, size } = input;
  const unit = Math.min(size.w, size.h) / 100;
  const bg = d.background.assetId && assets[d.background.assetId] ? `url(${assets[d.background.assetId]}) center/cover no-repeat, ` : "";
  const grad = d.background.gradientTo ? `linear-gradient(160deg, ${d.background.color}, ${d.background.gradientTo})` : d.background.color;
  const logos = d.logos.assetIds.map((id) => assets[id]).filter(Boolean);
  const justify = { "top-left": "flex-start", "top-center": "center", "top-right": "flex-end" }[d.logos.position];

  const blocks = Object.fromEntries(BLOCK_KEYS.map((k) => [k, blockHtml(k, d.blocks[k], data)])) as Record<BlockKey, string>;
  const sigs = d.signatories.show
    ? input.signatories
        .map(
          (s) => `<div class="sig">${s.imageSrc ? `<img src="${s.imageSrc}" alt="">` : `<div style="height:${u(6)}"></div>`}<div class="sig-line"></div><div class="sig-name">${esc(s.name)}</div><div class="sig-role">${esc(s.designation)}</div></div>`,
        )
        .join("")
    : "";
  const qr = d.qr.show && input.qrSrc ? `<img class="qr" src="${input.qrSrc}" alt="">` : "";
  const qrLeft = d.qr.position === "bottom-left";
  const certNo = data.certificate_no ? `<div class="certno">${esc(data.certificate_no)}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${input.fontCss}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${size.w}px;height:${size.h}px;overflow:hidden}
body{--u:${unit}px;position:relative;background:${bg}${grad};font-kerning:normal;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;}
${borderCss(d.border)}
.page{position:absolute;inset:0;padding:${u(7)} ${u(8)};display:flex;flex-direction:column;justify-content:space-between;}
.top{display:flex;flex-direction:column;gap:${u(1.6)};}
.logos{display:flex;gap:${u(2)};justify-content:${justify};align-items:center;min-height:${u(d.logos.height)};}
.logos img{height:${u(d.logos.height)};width:auto;max-width:40%;object-fit:contain;}
.mid{display:flex;flex-direction:column;gap:${u(2)};flex:1;justify-content:center;}
.bottom{display:flex;align-items:flex-end;gap:${u(3)};flex-direction:${qrLeft ? "row-reverse" : "row"};}
.bottom .grow{flex:1;display:flex;flex-direction:column;gap:${u(2)};}
.sigs{display:flex;justify-content:space-around;gap:${u(3)};}
.sig{text-align:center;min-width:${u(18)};max-width:${u(34)};font-family:'${esc(d.signatories.font)}',${FALLBACK};color:${d.signatories.color};}
.sig img{height:${u(6)};max-width:100%;object-fit:contain;display:block;margin:0 auto;}
.sig-line{border-top:${u(0.18)} solid ${d.signatories.color};margin:${u(0.6)} 0 ${u(0.8)};}
.sig-name{font-size:${u(d.signatories.size)};font-weight:700;line-height:1.4;}
.sig-role{font-size:${u(d.signatories.size * 0.85)};line-height:1.4;opacity:.85;}
.qr{width:${u(d.qr.size)};height:${u(d.qr.size)};}
.certno{font-family:'${esc(d.blocks.footer.font)}',${FALLBACK};font-size:${u(1.8)};color:${d.blocks.footer.color};text-align:${qrLeft ? "right" : "left"};}
.revoked{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 ${u(14)} sans-serif;color:rgba(200,0,0,.28);transform:rotate(-18deg);letter-spacing:.1em;}
</style></head><body><div class="frame"></div><div class="page">
<div class="top">${logos.length ? `<div class="logos">${logos.map((s) => `<img src="${s}" alt="">`).join("")}</div>` : ""}</div>
<div class="mid">${blocks.title}${blocks.subtitle}${blocks.recipient}${blocks.body}</div>
<div class="bottom"><div class="grow">${sigs ? `<div class="sigs">${sigs}</div>` : ""}${blocks.footer}${certNo}</div>${qr}</div>
</div>${input.revoked ? `<div class="revoked">REVOKED</div>` : ""}</body></html>`;
}
