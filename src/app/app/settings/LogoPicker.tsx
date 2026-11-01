"use client";
import { useState } from "react";

export function LogoPicker({ orgSlug, hasLogo, setLogo }: { orgSlug: string; hasLogo: boolean; setLogo: (id: string | null) => Promise<{ error?: string }> }) {
  const [has, setHas] = useState(hasLogo);
  const [v, setV] = useState(0);
  const [err, setErr] = useState("");
  return (
    <div className="space-y-2 text-sm">
      {has && /* eslint-disable-next-line @next/next/no-img-element */ <img key={v} src={`/o/${orgSlug}/logo?v=${v}`} alt="" className="h-14 w-auto rounded border bg-white p-1" />}
      <input type="file" aria-label="Choose a logo file" accept="image/png,image/jpeg,image/svg+xml" className="input" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const fd = new FormData(); fd.set("file", f); fd.set("kind", "LOGO");
        const up = await fetch("/api/assets", { method: "POST", body: fd }); const j = await up.json();
        if (!up.ok) return setErr(j.error ?? "Upload failed");
        const r = await setLogo(j.id); if (r.error) return setErr(r.error);
        setErr(""); setHas(true); setV((x) => x + 1);
      }} />
      {has && <button type="button" className="text-red-600" onClick={async () => { await setLogo(null); setHas(false); }}>Remove logo</button>}
      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}
