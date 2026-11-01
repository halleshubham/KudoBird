import { ActionForm, Field } from "@/components/ActionForm";
import { listPlans } from "@/server/admin/content";
import { FEATURE_KEYS, LIMIT_KEYS } from "@/server/entitlements";
import { requireSuperAdmin } from "@/server/session";
import { savePlanAction } from "../actions";

type P = { key: string; name: string; limits: Record<string, number>; features: Record<string, boolean>; isDefault: boolean; active: boolean };

function PlanForm({ p, orgs }: { p?: P; orgs?: number }) {
  return (
    <div className="card">
      <p className="mb-2 text-sm font-semibold">{p ? `${p.name} (${p.key}) · ${orgs} organisation${orgs === 1 ? "" : "s"}` : "New plan"}</p>
      <ActionForm action={savePlanAction} submit={p ? "Save plan" : "Create plan"}>
        {p ? <input type="hidden" name="key" value={p.key} /> : <Field name="key" label="Key (lowercase, e.g. pro)" required pattern="[a-z][a-z0-9_-]{1,29}" />}
        <Field name="name" label="Name" defaultValue={p?.name} required />
        <div className="grid grid-cols-2 gap-2">{LIMIT_KEYS.map((k) => <Field key={k} name={`limit_${k}`} label={`${k} (-1 = unlimited)`} type="number" min={-1} defaultValue={p?.limits[k] ?? ""} />)}</div>
        <div className="grid grid-cols-2 gap-1 text-sm">{FEATURE_KEYS.map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`feature_${k}`} defaultChecked={!!p?.features[k]} /> {k}</label>)}</div>
        <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="isDefault" defaultChecked={p?.isDefault} /> Default for new organisations</label><label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p ? p.active : true} /> Active</label></div>
      </ActionForm>
    </div>
  );
}

export default async function AdminPlans() {
  const admin = await requireSuperAdmin();
  const plans = await listPlans(admin.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Plans</h1>
      <p className="max-w-2xl text-sm text-neutral-600">Plans are configuration. Every limited action in the product asks the entitlement service, which reads these values, so switching on paid tiers means editing plans here, not changing code. Edits take effect immediately for every organisation on the plan. Billing providers (Razorpay / Stripe) are not connected yet.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => <PlanForm key={p.id} orgs={p.orgs} p={{ key: p.key, name: p.name, limits: p.limits as Record<string, number>, features: p.features as Record<string, boolean>, isDefault: p.isDefault, active: p.active }} />)}
        <PlanForm />
      </div>
    </div>
  );
}
