import { ActionForm, Field } from "@/components/ActionForm";
import { withTenant } from "@/server/db";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { updateOrgAction } from "../actions";

export default async function Settings() {
  const { ctx, role } = await requireOrg("org.view");
  const org = await withTenant(ctx, (tx) => tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }));
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Organisation settings</h1>
      <p className="text-sm text-gray-600">Public address: <code>/o/{org.slug}</code></p>
      {can(role, "org.update") ? (
        <div className="card">
          <ActionForm action={updateOrgAction} submit="Save">
            <Field name="name" label="Name" defaultValue={org.name} required />
            <Field name="primaryColor" label="Brand colour" defaultValue={org.primaryColor ?? "#7c3aed"} pattern="#[0-9a-fA-F]{6}" required />
          </ActionForm>
        </div>
      ) : <p className="text-sm text-gray-600">Only admins can change these settings.</p>}
    </div>
  );
}
