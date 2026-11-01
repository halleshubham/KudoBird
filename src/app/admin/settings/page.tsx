import { ActionForm, Field } from "@/components/ActionForm";
import { getSettings, listPlans } from "@/server/admin/content";
import { requireSuperAdmin } from "@/server/session";
import { saveSettingsAction } from "../actions";

export default async function AdminSettings() {
  const admin = await requireSuperAdmin();
  const [s, plans] = await Promise.all([getSettings(admin.id), listPlans(admin.id)]);
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Global settings</h1>
      <div className="card">
        <ActionForm action={saveSettingsAction} submit="Save settings">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="signupsOpen" defaultChecked={s.signupsOpen} className="mt-1" /> <span>Allow new sign-ups<br /><span className="text-xs text-neutral-500">When off, nobody can create a new account (existing users, invitations to existing accounts and public forms keep working).</span></span></label>
          <div><label className="label" htmlFor="defaultPlanKey">Plan for newly created organisations</label><select id="defaultPlanKey" name="defaultPlanKey" defaultValue={s.defaultPlanKey} className="input">{plans.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></div>
          <Field name="announcement" label="Announcement banner (shown to every signed-in user; empty = none)" defaultValue={s.announcement} maxLength={300} />
        </ActionForm>
      </div>
    </div>
  );
}
