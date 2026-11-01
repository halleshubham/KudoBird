"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { designFonts, type Design, type BlockKey } from "@/server/render/design";
import { renderCertificateHtml } from "@/server/render/html";

type Preset = { key: string; name: string; description: string; design: Design };
type Sig = { id: string; name: string; designation: string; assetId: string | null };
type Asset = { id: string; filename: string };
type FontOpt = { family: string; curated: boolean };
const SIZES = { square: [1080, 1080], story: [1080, 1920], link: [1200, 630], a4: [1754, 1240] } as const;
const BLOCKS: [BlockKey, string][] = [["title", "Title"], ["subtitle", "Subtitle"], ["recipient", "Recipient name"], ["body", "Body"], ["footer", "Footer"]];

function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const [q, setQ] = useState("");
  const [script, setScript] = useState("");
  const [opts, setOpts] = useState<FontOpt[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/fonts?q=${encodeURIComponent(q)}&subset=${script}`, { signal: ctl.signal }).then((r) => r.json()).then(setOpts).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, script]);
  const list = opts.some((o) => o.family === value) ? opts : [{ family: value, curated: true }, ...opts];
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <input className="input" placeholder="Search fonts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={script} onChange={(e) => setScript(e.target.value)} aria-label="Script">
          <option value="">All</option><option value="devanagari">Devanagari</option><option value="latin">Latin</option>
        </select>
      </div>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((f) => <option key={f.family} value={f.family}>{f.curated ? "★ " : ""}{f.family}</option>)}
      </select>
    </div>
  );
}

export function Designer(props: {
  campaignId: string; templateId: string; initial: Design; presets: Preset[]; logos: Asset[]; signatories: Sig[]; selectedSignatoryIds: string[];
  sample: { data: Record<string, string>; qrSrc: string }; canEdit: boolean; version: number;
  save: (campaignId: string, templateId: string, design: unknown, sigs: string[]) => Promise<{ error?: string; info?: string }>;
}) {
  const [design, setDesign] = useState<Design>(props.initial);
  const [sigIds, setSigIds] = useState<string[]>(props.selectedSignatoryIds);
  const [logos, setLogos] = useState<Asset[]>(props.logos);
  const [size, setSize] = useState<keyof typeof SIZES>("square");
  const [fontCss, setFontCss] = useState("");
  const [msg, setMsg] = useState<{ error?: string; info?: string }>();
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [w, h] = SIZES[size];

  // Fonts: same-origin @font-face rules for the families in use (missing ones are downloaded once by the server).
  const fontKey = designFonts(design).sort().join("\n");
  useEffect(() => {
    const ctl = new AbortController();
    const qs = fontKey.split("\n").map((f) => `f=${encodeURIComponent(f)}`).join("&");
    fetch(`/api/fonts/css?${qs}`, { signal: ctl.signal }).then((r) => (r.ok ? r.text() : "")).then((css) => css && setFontCss(css)).catch(() => {});
    return () => ctl.abort();
  }, [fontKey]);

  // The preview is rendered right here with the same pure function the worker uses, so every control updates instantly.
  const html = useMemo(() => {
    const assets: Record<string, string> = {};
    for (const id of [...design.logos.assetIds, design.background.assetId]) if (id) assets[id] = `/api/assets/${id}`;
    const signatories = sigIds.flatMap((id) => props.signatories.find((x) => x.id === id) ?? []).map((s) => ({ name: s.name, designation: s.designation, imageSrc: s.assetId ? `/api/assets/${s.assetId}` : null }));
    return renderCertificateHtml({ design, data: props.sample.data, assets, signatories, qrSrc: props.sample.qrSrc, size: { w, h }, fontCss });
  }, [design, sigIds, fontCss, w, h, props.signatories, props.sample]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);

  const set = useCallback((fn: (d: Design) => Design) => setDesign((d) => fn(structuredClone(d))), []);

  async function upload(kind: "LOGO" | "BACKGROUND", file: File) {
    const fd = new FormData();
    fd.set("file", file); fd.set("kind", kind);
    const res = await fetch("/api/assets", { method: "POST", body: fd });
    const j = await res.json();
    if (!res.ok) return setMsg({ error: j.error });
    if (kind === "LOGO") {
      setLogos((l) => [{ id: j.id, filename: file.name }, ...l]);
      set((d) => { d.logos.assetIds = [...d.logos.assetIds, j.id].slice(0, 3); return d; });
    } else set((d) => { d.background.assetId = j.id; return d; });
  }

  const dis = !props.canEdit;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-3 text-sm">
        <fieldset disabled={dis} className="space-y-3">
          <details open className="card"><summary className="cursor-pointer font-semibold">Starting layout</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {props.presets.map((p) => (
                <button key={p.key} type="button" className={`rounded border p-2 text-left ${design.preset === p.key ? "border-brand-600 bg-brand-50" : "border-gray-200"}`}
                  onClick={() => { if (confirm("Replace the current design with this preset?")) setDesign(structuredClone(p.design)); }}>
                  <span className="font-medium">{p.name}</span><br /><span className="text-xs text-gray-500">{p.description}</span>
                </button>
              ))}
            </div>
          </details>
          <details className="card"><summary className="cursor-pointer font-semibold">Background & border</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label>Colour<input type="color" className="input !p-1" value={design.background.color} onChange={(e) => set((d) => { d.background.color = e.target.value; return d; })} /></label>
              <label>Gradient to<input type="color" className="input !p-1" value={design.background.gradientTo ?? design.background.color} onChange={(e) => set((d) => { d.background.gradientTo = e.target.value; return d; })} /></label>
              <label>Border<select className="input" value={design.border.style} onChange={(e) => set((d) => { d.border.style = e.target.value as Design["border"]["style"]; if (d.border.width === 0) d.border.width = 1; return d; })}>
                {["none", "solid", "double", "ornate"].map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>Border colour<input type="color" className="input !p-1" value={design.border.color} onChange={(e) => set((d) => { d.border.color = e.target.value; return d; })} /></label>
              <label>Border width<input type="range" min={0} max={4} step={0.1} value={design.border.width} onChange={(e) => set((d) => { d.border.width = Number(e.target.value); return d; })} /></label>
              <label>Inset<input type="range" min={0} max={8} step={0.2} value={design.border.inset} onChange={(e) => set((d) => { d.border.inset = Number(e.target.value); return d; })} /></label>
            </div>
            <div className="mt-2"><label>Background image<input type="file" accept="image/png,image/jpeg,image/svg+xml" className="input" onChange={(e) => e.target.files?.[0] && upload("BACKGROUND", e.target.files[0])} /></label>
              {design.background.assetId && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label>Image fit<select className="input" value={design.background.fit} onChange={(e) => set((d) => { d.background.fit = e.target.value as Design["background"]["fit"]; return d; })}><option value="cover">Fill page</option><option value="contain">Fit inside</option></select></label>
                  <label>Colour wash<input type="range" min={0} max={0.9} step={0.05} value={design.background.overlay} onChange={(e) => set((d) => { d.background.overlay = Number(e.target.value); return d; })} /></label>
                  <button type="button" className="text-left text-red-600" onClick={() => set((d) => { d.background.assetId = null; return d; })}>Remove image</button>
                </div>)}</div>
          </details>
          <details className="card"><summary className="cursor-pointer font-semibold">Logos</summary>
            <div className="mt-2 space-y-2">
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="input" onChange={(e) => e.target.files?.[0] && upload("LOGO", e.target.files[0])} />
              {logos.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={design.logos.assetIds.includes(l.id)} onChange={(e) => set((d) => { d.logos.assetIds = e.target.checked ? [...d.logos.assetIds, l.id].slice(0, 3) : d.logos.assetIds.filter((x) => x !== l.id); return d; })} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${l.id}`} alt="" className="h-8 w-auto" /> <span className="truncate">{l.filename}</span>
                </label>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <label>Position<select className="input" value={design.logos.position} onChange={(e) => set((d) => { d.logos.position = e.target.value as Design["logos"]["position"]; return d; })}>
                  <option value="top-left">Left</option><option value="top-center">Centre</option><option value="top-right">Right</option></select></label>
                <label>Size<input type="range" min={4} max={20} value={design.logos.height} onChange={(e) => set((d) => { d.logos.height = Number(e.target.value); return d; })} /></label>
              </div>
            </div>
          </details>
          {BLOCKS.map(([key, label]) => {
            const b = design.blocks[key];
            return (
              <details key={key} className="card"><summary className="cursor-pointer font-semibold">{label}</summary>
                <div className="mt-2 space-y-2">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={b.show} onChange={(e) => set((d) => { d.blocks[key].show = e.target.checked; return d; })} /> Show</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={b.italic} onChange={(e) => set((d) => { d.blocks[key].italic = e.target.checked; return d; })} /> Italic</label>
                  </div>
                  <textarea className="input" rows={key === "body" ? 3 : 2} value={b.text} onChange={(e) => set((d) => { d.blocks[key].text = e.target.value; return d; })} />
                  <FontPicker value={b.font} onChange={(f) => set((d) => { d.blocks[key].font = f; return d; })} />
                  <div className="grid grid-cols-2 gap-2">
                    <label>Size<input type="range" min={1} max={14} step={0.1} value={b.size} onChange={(e) => set((d) => { d.blocks[key].size = Number(e.target.value); return d; })} /></label>
                    <label>Weight<select className="input" value={b.weight} onChange={(e) => set((d) => { d.blocks[key].weight = Number(e.target.value); return d; })}>{[400, 500, 600, 700, 800].map((x) => <option key={x}>{x}</option>)}</select></label>
                    <label>Align<select className="input" value={b.align} onChange={(e) => set((d) => { d.blocks[key].align = e.target.value as typeof b.align; return d; })}><option>left</option><option>center</option><option>right</option></select></label>
                    <label>Colour<input type="color" className="input !p-1" value={b.color} onChange={(e) => set((d) => { d.blocks[key].color = e.target.value; return d; })} /></label>
                  </div>
                </div>
              </details>
            );
          })}
          <details className="card"><summary className="cursor-pointer font-semibold">Signatories & QR</summary>
            <div className="mt-2 space-y-2">
              {props.signatories.length === 0 && <p className="text-gray-500">Add signatories in the Signatories library first.</p>}
              {sigIds.map((id, i) => { const s = props.signatories.find((x) => x.id === id); return s && (
                <div key={id} className="flex items-center gap-2"><span className="flex-1">{i + 1}. {s.name}</span>
                  <button type="button" disabled={i === 0} onClick={() => setSigIds((a) => { const n = [...a]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                  <button type="button" className="text-red-600" onClick={() => setSigIds((a) => a.filter((x) => x !== id))}>✕</button></div>); })}
              {props.signatories.filter((s) => !sigIds.includes(s.id)).map((s) => (
                <button key={s.id} type="button" className="btn-ghost mr-1" disabled={sigIds.length >= 4} onClick={() => setSigIds((a) => [...a, s.id])}>+ {s.name}</button>
              ))}
              <label className="flex items-center gap-2"><input type="checkbox" checked={design.signatories.show} onChange={(e) => set((d) => { d.signatories.show = e.target.checked; return d; })} /> Show signatories</label>
              <FontPicker value={design.signatories.font} onChange={(f) => set((d) => { d.signatories.font = f; return d; })} />
              <div className="grid grid-cols-2 gap-2">
                <label>Signature text size<input type="range" min={1} max={8} step={0.1} value={design.signatories.size} onChange={(e) => set((d) => { d.signatories.size = Number(e.target.value); return d; })} /></label>
                <label>Signature colour<input type="color" className="input !p-1" value={design.signatories.color} onChange={(e) => set((d) => { d.signatories.color = e.target.value; return d; })} /></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={design.qr.show} onChange={(e) => set((d) => { d.qr.show = e.target.checked; return d; })} /> Show verification QR code</label>
              <label>QR position<select className="input" value={design.qr.position} onChange={(e) => set((d) => { d.qr.position = e.target.value as Design["qr"]["position"]; return d; })}><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></select></label>
              <label>QR size<input type="range" min={6} max={20} step={0.5} value={design.qr.size} onChange={(e) => set((d) => { d.qr.size = Number(e.target.value); return d; })} /></label>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setMsg(await props.save(props.campaignId, props.templateId, design, sigIds)))}>{pending ? "Saving…" : "Save new version"}</button>
            <span className="text-gray-500">Current: v{props.version}</span>
          </div>
        </fieldset>
        {dis && <p className="text-gray-600">You have read-only access to this design.</p>}
        {msg?.error && <p className="rounded bg-red-50 p-2 text-red-700">{msg.error}</p>}
        {msg?.info && <p className="rounded bg-green-50 p-2 text-green-800">{msg.info}</p>}
      </div>
      <div className="space-y-2">
        <select className="input !w-auto" value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)} aria-label="Preview size">
          <option value="square">Square 1080×1080</option><option value="story">Story 1080×1920</option><option value="link">Link preview 1200×630</option><option value="a4">A4 landscape</option>
        </select>
        <div ref={box} className="w-full overflow-hidden rounded border bg-gray-100" style={{ height: h * scale }}>
          <iframe title="Certificate preview" srcDoc={html} sandbox="allow-same-origin" style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", background: "#fff" }} />
        </div>
        <p className="text-xs text-gray-500">Preview uses sample data and updates as you type. Saving creates a new version; certificates already issued keep the version they were issued with.</p>
      </div>
    </div>
  );
}
