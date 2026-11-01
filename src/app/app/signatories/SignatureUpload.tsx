"use client";
import { useState } from "react";

/** Uploads the signature image immediately and puts the asset id in a hidden field of the surrounding form. */
export function SignatureUpload() {
  const [id, setId] = useState("");
  const [err, setErr] = useState("");
  return (
    <div>
      <label className="label" htmlFor="sig">Signature image (PNG with transparent background)</label>
      <input id="sig" type="file" accept="image/png,image/jpeg,image/svg+xml" className="input" onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const fd = new FormData(); fd.set("file", file); fd.set("kind", "SIGNATURE");
        const res = await fetch("/api/assets", { method: "POST", body: fd }); const j = await res.json();
        if (res.ok) { setId(j.id); setErr(""); } else setErr(j.error ?? "Upload failed");
      }} />
      <input type="hidden" name="assetId" value={id} />
      {id && <p className="text-xs text-green-700">Uploaded ✓</p>}
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
