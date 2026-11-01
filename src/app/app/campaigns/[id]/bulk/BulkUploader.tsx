"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { BulkPreview, BulkResult, RowStatus } from "@/server/bulk";

type Actions = {
  preview: (id: string, text: string) => Promise<{ preview?: BulkPreview; error?: string }>;
  commit: (id: string, text: string, attested: boolean, emails: boolean) => Promise<{ result?: BulkResult; error?: string }>;
};
const LABEL: Record<RowStatus, string> = { ok: "Will be issued", invalid: "Invalid", duplicate_in_file: "Duplicate in file", duplicate_existing: "Already has an entry" };
const STYLE: Record<RowStatus, string> = { ok: "bg-green-100 text-green-800", invalid: "bg-red-100 text-red-800", duplicate_in_file: "bg-amber-100 text-amber-900", duplicate_existing: "bg-amber-100 text-amber-900" };

export function BulkUploader({ campaignId, actions }: { campaignId: string; actions: Actions }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<BulkPreview>();
  const [result, setResult] = useState<BulkResult>();
  const [error, setError] = useState("");
  const [attested, setAttested] = useState(false);
  const [emails, setEmails] = useState(false);
  const [pending, start] = useTransition();

  async function onFile(f: File) {
    setResult(undefined); setPreview(undefined); setError(""); setFileName(f.name);
    const t = await f.text();
    setText(t);
    start(async () => { const r = await actions.preview(campaignId, t); if (r.error) setError(r.error); else setPreview(r.preview); });
  }
  const canIssue = preview && !preview.fileError && preview.willIssue > 0 && !preview.overLimit && attested;

  return (
    <div className="space-y-4">
      <div className="card space-y-2 text-sm">
        <p className="font-semibold">1. Upload a CSV</p>
        <p className="text-neutral-600">Columns: <code>name</code>, <code>mobile</code>, optional <code>email</code>, plus any of the campaign&apos;s custom field keys. Up to 2,000 rows. <a className="text-brand-700 underline" href={`/api/campaigns/${campaignId}/bulk-template`}>Download a template</a>.</p>
        <input type="file" aria-label="Choose a CSV file" accept=".csv,text/csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {pending && <p className="text-neutral-500" role="status">Checking {fileName}…</p>}
        {error && <p className="rounded bg-red-50 p-2 text-red-700" role="alert">{error}</p>}
      </div>

      {preview?.fileError && <p className="rounded bg-red-50 p-3 text-red-700" role="alert">{preview.fileError}</p>}

      {preview && !preview.fileError && !result && (
        <div className="card space-y-3 text-sm">
          <p className="font-semibold">2. Review</p>
          <p className="flex flex-wrap gap-2">
            {(Object.keys(preview.counts) as RowStatus[]).filter((k) => preview.counts[k] > 0).map((k) => <span key={k} className={`rounded px-2 py-0.5 ${STYLE[k]}`}>{preview.counts[k]} {LABEL[k].toLowerCase()}</span>)}
          </p>
          {preview.unknownColumns.length > 0 && <p className="text-amber-800">Ignored columns: {preview.unknownColumns.join(", ")}</p>}
          {preview.overLimit && <p className="rounded bg-red-50 p-2 text-red-700" role="alert">Your plan allows {preview.remaining} more certificate(s) this month, but this file would issue {preview.willIssue}. Remove rows or ask your administrator to raise the limit.</p>}
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-neutral-50"><tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2">Mobile</th><th className="p-2">Status</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t align-top">
                    <td className="p-2 text-neutral-500">{r.line}</td><td className="p-2">{r.name}</td><td className="p-2">{r.mobileMasked}</td>
                    <td className="p-2"><span className={`rounded px-2 py-0.5 ${STYLE[r.status]}`}>{LABEL[r.status]}</span>{r.errors.map((e, i) => <p key={i} className="text-xs text-red-700">{e}</p>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length < Object.values(preview.counts).reduce((a, b) => a + b, 0) && <p className="text-xs text-neutral-500">Showing the first {preview.rows.length} rows. All rows are checked when you issue.</p>}
          <p className="font-semibold">3. Issue</p>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={attested} onChange={(e) => setAttested(e.target.checked)} /> I confirm that each person listed has given consent for their details to be used to issue this certificate.</label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={emails} onChange={(e) => setEmails(e.target.checked)} /> Email each certificate to people who have an email address (otherwise nothing is sent; you can resend individually).</label>
          <button className="btn" disabled={!canIssue || pending} onClick={() => start(async () => { const r = await actions.commit(campaignId, text, attested, emails); if (r.error) setError(r.error); else setResult(r.result); })}>
            Issue {preview.willIssue} certificate{preview.willIssue === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {result && (
        <div className="card space-y-1 text-sm" role="status">
          <p className="font-semibold text-green-800">Done: {result.issued} certificate{result.issued === 1 ? "" : "s"} issued.</p>
          {result.skipped > 0 && <p>{result.skipped} row(s) skipped (invalid or duplicate).</p>}
          {result.failed > 0 && <p className="text-red-700">{result.failed} row(s) failed. Check the audit log and try those again.</p>}
          <p>The images are being prepared in the background. <Link className="text-brand-700 underline" href={`/app/campaigns/${campaignId}/entries`}>View entries</Link></p>
        </div>
      )}
    </div>
  );
}
