"use client";
import { useActionState, useState } from "react";
import type { FormField } from "@/server/campaigns/schema";
import { Notice } from "@/components/AuthShell";
import { SubmitButton } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { EmptyState } from "@/components/ui";

type State = { error?: string; info?: string } | undefined;
const slugKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const blank = (): FormField => ({ key: "", label: "", translations: {}, type: "text", required: false, options: [], showOnCertificate: false });

export function FieldsEditor({ campaignId, initial, action }: { campaignId: string; initial: FormField[]; action: (s: State, fd: FormData) => Promise<State> }) {
  const [fields, setFields] = useState<FormField[]>(initial);
  const [state, formAction] = useActionState(action, undefined);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const patch = (i: number, p: Partial<FormField>) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setFields((f) => { const n = [...f]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={campaignId} />
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      {state?.info && <Notice kind="info">{state.info}</Notice>}
      <p className="text-sm text-neutral-600">Full name and mobile number are always asked. Email is optional. Add your own fields below.</p>
      {fields.map((f, i) => (
        <div key={i} className="card space-y-3 text-sm">
          <p className="font-semibold text-neutral-700">Field {i + 1}{f.label ? `: ${f.label}` : ""}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div><label className="label" htmlFor={`f${i}-L2615`}>Label</label><input id={`f${i}-L2615`} className="input" value={f.label} onChange={(e) => patch(i, { label: e.target.value, ...(f.key === slugKey(f.label) ? { key: slugKey(e.target.value) } : {}) })} /></div>
            <div><label className="label" htmlFor={`f${i}-L9200`}>Key (for {"{{key}}"})</label><input id={`f${i}-L9200`} className="input" value={f.key} onChange={(e) => patch(i, { key: e.target.value.toLowerCase() })} /></div>
            <div><label className="label" htmlFor={`f${i}-type`}>Type</label>
              <select id={`f${i}-type`} className="input" value={f.type} onChange={(e) => patch(i, { type: e.target.value as FormField["type"] })}>
                {[["text", "Short text"], ["number", "Number"], ["date", "Date"], ["select", "Dropdown"], ["textarea", "Long text"]].map(([t, n]) => <option key={t} value={t}>{n}</option>)}
              </select></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="label" htmlFor={`f${i}-L9064`}>Label in Hindi</label><input id={`f${i}-L9064`} className="input" value={f.translations.hi ?? ""} onChange={(e) => patch(i, { translations: { ...f.translations, hi: e.target.value || undefined } })} /></div>
            <div><label className="label" htmlFor={`f${i}-L5654`}>Label in Marathi</label><input id={`f${i}-L5654`} className="input" value={f.translations.mr ?? ""} onChange={(e) => patch(i, { translations: { ...f.translations, mr: e.target.value || undefined } })} /></div>
          </div>
          {f.type === "select" && (
            <div><label className="label">Options (one per line)</label>
              <textarea className="input" rows={3} value={f.options.join("\n")} onChange={(e) => patch(i, { options: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></div>
          )}
          {(f.type === "number" || f.type === "text" || f.type === "textarea") && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor={`f${i}-L1741`}>{f.type === "number" ? "Minimum" : "Min length"}</label><input id={`f${i}-L1741`} type="number" className="input" value={f.min ?? ""} onChange={(e) => patch(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
              <div><label className="label" htmlFor={`f${i}-L5491`}>{f.type === "number" ? "Maximum" : "Max length"}</label><input id={`f${i}-L5491`} type="number" className="input" value={f.max ?? ""} onChange={(e) => patch(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} /> Required</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.showOnCertificate} onChange={(e) => patch(i, { showOnCertificate: e.target.checked })} /> Available on certificate</label>
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-ghost" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn-ghost" aria-label={`Move field ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>↓</button>
              <ConfirmButton className="btn-link-danger" danger title="Remove this field?" confirmLabel="Remove field" message="Answers already collected for it stay in the entries, but the field disappears from the public form and from certificate placeholders once you save." onConfirm={() => setFields((x) => x.filter((_, j) => j !== i))}>Remove</ConfirmButton>
            </span>
          </div>
        </div>
      ))}
      {fields.length === 0 && <EmptyState title="No extra questions yet">Ask for anything you want on the certificate or in your records, such as village, organisation or role.</EmptyState>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" onClick={() => setFields((f) => [...f, blank()])}>+ Add field</button>
        <SubmitButton pendingLabel="Saving…">Save fields</SubmitButton>
        {dirty && <span className="text-sm text-amber-700" role="status">Unsaved changes</span>}
      </div>
    </form>
  );
}
