import { ActionForm, Field, SubmitButton } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge, PageHeader } from "@/components/ui";
import { canManageRole } from "@/server/permissions";
import { listMembers } from "@/server/orgs";
import { requireOrg } from "@/server/session";
import { changeRoleAction, inviteAction, removeMemberAction, revokeInviteAction } from "../actions";

const ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
const ROLE_HELP: Record<string, string> = {
  OWNER: "Full control, including billing and deleting the workspace",
  ADMIN: "Manage members, settings and everything below",
  EDITOR: "Create and edit campaigns, designs and entries",
  VIEWER: "Read-only access",
};
const label = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export default async function Members() {
  const { ctx, role, user } = await requireOrg("members.view");
  const { members, invites } = await listMembers(ctx);
  const canInvite = canManageRole(role, "VIEWER");
  return (
    <div className="space-y-6">
      <PageHeader title="Members" description="People who can sign in to this workspace. Roles decide what they can change." />
      <div className="card divide-y divide-black/10">
        {members.map((m) => {
          const editable = m.userId !== user.id && canManageRole(role, m.role);
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.user.name ?? m.user.email}</p>
                <p className="truncate text-neutral-500">{m.user.email}</p>
              </div>
              {editable ? (
                <form action={changeRoleAction} className="flex gap-2">
                  <input type="hidden" name="userId" value={m.userId} />
                  <select name="role" defaultValue={m.role} aria-label={`Role of ${m.user.name ?? m.user.email}`} className="input !w-auto">
                    {ROLES.filter((r) => canManageRole(role, r)).map((r) => <option key={r} value={r}>{label(r)}</option>)}
                  </select>
                  <SubmitButton className="btn-ghost" pendingLabel="Saving…">Update</SubmitButton>
                </form>
              ) : <Badge tone={m.role === "OWNER" ? "blue" : "neutral"}>{label(m.role)}</Badge>}
              {(editable || m.userId === user.id) && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="userId" value={m.userId} />
                  <ConfirmButton className="btn-link-danger" danger title={m.userId === user.id ? "Leave this workspace?" : "Remove this member?"} confirmLabel={m.userId === user.id ? "Leave workspace" : "Remove member"}
                    message={m.userId === user.id ? "You will lose access to this workspace straight away. Another owner would have to invite you back." : `${m.user.name ?? m.user.email} will lose access straight away. Their past work stays.`}>{m.userId === user.id ? "Leave" : "Remove"}</ConfirmButton>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {invites.length > 0 && (
        <div className="card divide-y">
          <p className="pb-2 text-sm font-semibold">Pending invitations</p>
          {invites.map((i) => (
            <form key={i.id} action={revokeInviteAction} className="flex items-center gap-3 py-2 text-sm">
              <input type="hidden" name="inviteId" value={i.id} />
              <span className="flex-1 truncate">{i.email} <Badge>{label(i.role)}</Badge></span>
              {canInvite && <ConfirmButton className="btn-link-danger" danger title="Revoke invitation?" confirmLabel="Revoke" message={`The link sent to ${i.email} will stop working.`}>Revoke</ConfirmButton>}
            </form>
          ))}
        </div>
      )}
      {canInvite && (
        <div className="card max-w-xl">
          <h2 className="mb-3 font-semibold">Invite a member</h2>
          <ActionForm action={inviteAction} submit="Send invitation" pendingLabel="Sending…">
            <Field name="email" label="Email" type="email" autoComplete="off" required hint="We email them a link to join. It works for 7 days." />
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="EDITOR" className="input" aria-describedby="role-help">
                {ROLES.filter((r) => canManageRole(role, r)).map((r) => <option key={r} value={r}>{label(r)} – {ROLE_HELP[r]}</option>)}
              </select>
              <p id="role-help" className="mt-1 text-xs text-neutral-500">You can change a role at any time.</p>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
