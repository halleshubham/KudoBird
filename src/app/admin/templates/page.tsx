import { ActionButton } from "@/components/ActionButton";
import { ActionForm, Field } from "@/components/ActionForm";
import { listGlobalTemplates } from "@/server/admin/content";
import { PRESET_INFO, PRESETS } from "@/server/render/presets";
import { requireSuperAdmin } from "@/server/session";
import { createTemplateAction, deleteTemplateAction, renameTemplateAction, saveTemplateDesignAction } from "../actions";

export default async function AdminTemplates() {
  const admin = await requireSuperAdmin();
  const templates = await listGlobalTemplates(admin.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Starter templates</h1>
      <p className="max-w-2xl text-sm text-neutral-600">The gallery organisations can clone. Saving a design creates a new version of the starter; organisations that already cloned one keep their own copy, unchanged.</p>
      <div className="space-y-4">
        {templates.map((t) => (
          <details key={t.id} className="card" open={templates.length <= 1}>
            <summary className="cursor-pointer font-semibold">{t.name} <span className="text-sm font-normal text-neutral-500">· {t.preset} · v{t.latestVersion}</span></summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <div className="space-y-3">
                <ActionForm action={renameTemplateAction} submit="Rename"><input type="hidden" name="id" value={t.id} /><Field name="name" label="Name" defaultValue={t.name} required /><Field name="description" label="Description" defaultValue={t.description ?? ""} /></ActionForm>
                <ActionButton action={deleteTemplateAction} fields={{ id: t.id }} label="Delete template" danger confirm="Delete this starter template? Organisations' copies are not affected." />
              </div>
              <ActionForm action={saveTemplateDesignAction} submit="Save as new version">
                <input type="hidden" name="id" value={t.id} />
                <label className="label" htmlFor={`d-${t.id}`}>Design (JSON, validated on save)</label>
                <textarea id={`d-${t.id}`} name="design" rows={14} className="input font-mono text-xs" defaultValue={JSON.stringify(t.design, null, 2)} />
              </ActionForm>
            </div>
          </details>
        ))}
      </div>
      <div className="card max-w-md"><p className="mb-3 text-sm font-semibold">Add a starter template</p>
        <ActionForm action={createTemplateAction} submit="Create from preset">
          <Field name="name" label="Name" required />
          <div><label className="label" htmlFor="preset">Preset layout</label><select id="preset" name="preset" className="input">{PRESETS.map((p) => <option key={p} value={p}>{PRESET_INFO[p].name}</option>)}</select></div>
          <div><label className="label" htmlFor="locale">Default wording</label><select id="locale" name="locale" className="input" defaultValue="mr"><option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="en">English</option></select></div>
        </ActionForm></div>
    </div>
  );
}
