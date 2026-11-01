import { ActionForm, Field } from "@/components/ActionForm";
import { withTenant } from "@/server/db";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { setNotificationsAction, setOrgLogoAction, updateOrgAction } from "../actions";
import { LogoPicker } from "./LogoPicker";

export default async function Settings() {
  const { ctx, role } = await requireOrg("org.view");
  const { org, me } = await withTenant(ctx, async (tx) => ({ org: await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }), me: await tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } }) }));
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Organisation settings</h1>
      <p className="text-sm text-gray-600">Public page: <a className="text-brand-700 underline" href={`/o/${org.slug}`} target="_blank">/o/{org.slug}</a></p>
      {can(role, "org.update") ? (
        <div className="card">
          <ActionForm action={updateOrgAction} submit="Save">
            <Field name="name" label="Name" defaultValue={org.name} required />
            <Field name="primaryColor" label="Brand colour" defaultValue={org.primaryColor ?? "#7c3aed"} pattern="#[0-9a-fA-F]{6}" required />
          </ActionForm>
          <div className="mt-4 border-t pt-4"><p className="mb-2 text-sm font-medium">Logo (shown on your public page)</p><LogoPicker orgSlug={org.slug} hasLogo={!!org.logoAssetId} setLogo={setOrgLogoAction} /></div>
        </div>
      ) : <p className="text-sm text-gray-600">Only admins can change these settings.</p>}
      <div className="card">
        <p className="mb-2 text-sm font-semibold">Notifications: new entries</p>
        <form action={setNotificationsAction} className="flex items-center gap-2 text-sm">
          <select name="mode" defaultValue={me.entryNotifications} className="input !w-auto"><option value="INSTANT">Instant email</option><option value="DAILY">Daily digest (9:00 IST)</option><option value="OFF">Off</option></select>
          <button className="btn-ghost">Save</button>
        </form>
      </div>
    </div>
  );
}
