"use client";
import { useState } from "react";

/** Downloads everything stored about one person as JSON (data-access request). The action is audit-logged. */
export function ExportDataButton({ entryId, action }: { entryId: string; action: (id: string) => Promise<{ data?: unknown; error?: string }> }) {
  const [err, setErr] = useState("");
  return (
    <span>
      <button type="button" className="text-neutral-700" title="Download all data held about this person (DPDP request)" onClick={async () => {
        const r = await action(entryId);
        if (r.error) return setErr(r.error);
        const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `entry-${entryId}.json`; a.click(); URL.revokeObjectURL(url);
      }}>Export data</button>
      {err && <span className="ml-1 text-xs text-red-700">{err}</span>}
    </span>
  );
}
