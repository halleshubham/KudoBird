import { ActionForm, Field, SubmitButton } from "@/components/ActionForm";
import { ColorField } from "@/components/ColorField";
import { PageHeader } from "@/components/ui";
import { getNotificationMode, getOrganization } from "@/server/orgs";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { setNotificationsAction, setOrgLogoAction, updateOrgAction } from "../actions";
import { LogoPicker } from "./LogoPicker";

export default async function Settings() {
  const { ctx, role } = await requireOrg("org.view");
  const [org, notificationMode] = await Promise.all([getOrganization(ctx), getNotificationMode(ctx)]);
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Organisation settings" description={<>Your public page: <a className="text-brand-700 underline" href={`/o/${org.slug}`} target="_blank" rel="noreferrer">/o/{org.slug}<span className="sr-only"> (opens in a new tab)</span></a></>} />
      {can(role, "org.update") ? (
        <div className="card">
          <ActionForm action={updateOrgAction} submit="Save changes" pendingLabel="Saving…">
            <Field name="name" label="Organisation name" defaultValue={org.name} required />
            <ColorField name="primaryColor" label="Brand colour" defaultValue={org.primaryColor ?? "#0b6cf0"} hint="Used for buttons and accents on your public form." />
          </ActionForm>
          <div className="mt-5 border-t border-black/10 pt-4"><p className="mb-2 text-sm font-medium">Logo</p><p className="mb-2 text-xs text-neutral-500">Shown on your public page. PNG, JPG or SVG up to 3 MB.</p><LogoPicker orgSlug={org.slug} hasLogo={!!org.logoAssetId} setLogo={setOrgLogoAction} /></div>
        </div>
      ) : <p className="text-sm text-neutral-600">Only admins can change these settings.</p>}
      <div className="card">
        <h2 className="font-semibold">Email notifications</h2>
        <p className="mb-3 text-sm text-neutral-600">How you hear about new entries. This is your own preference, not the whole team&apos;s.</p>
        <form action={setNotificationsAction} className="flex flex-wrap items-end gap-2 text-sm">
          <div><label className="label" htmlFor="mode">New entries</label>
            <select id="mode" name="mode" defaultValue={notificationMode} className="input !w-auto"><option value="INSTANT">Instant email</option><option value="DAILY">Daily digest (9:00 IST)</option><option value="OFF">Off</option></select></div>
          <SubmitButton className="btn-ghost" pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </div>
    </div>
  );
}
