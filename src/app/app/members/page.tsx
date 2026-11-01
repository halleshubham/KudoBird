import { ActionForm, Field } from "@/components/ActionForm";
import { canManageRole } from "@/server/permissions";
import { listMembers } from "@/server/orgs";
import { requireOrg } from "@/server/session";
import { changeRoleAction, inviteAction, removeMemberAction, revokeInviteAction } from "../actions";

const ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;

export default async function Members() {
  const { ctx, role, user } = await requireOrg("members.view");
  const { members, invites } = await listMembers(ctx);
  const canInvite = canManageRole(role, "VIEWER");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Members</h1>
      <div className="card divide-y">
        {members.map((m) => {
          const editable = m.userId !== user.id && canManageRole(role, m.role);
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.user.name ?? m.user.email}</p>
                <p className="truncate text-gray-500">{m.user.email}</p>
              </div>
              {editable ? (
                <form action={changeRoleAction} className="flex gap-2">
                  <input type="hidden" name="userId" value={m.userId} />
                  <select name="role" defaultValue={m.role} className="input !w-auto">
                    {ROLES.filter((r) => canManageRole(role, r)).map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <button className="btn-ghost">Update</button>
                </form>
              ) : <span className="text-gray-600">{m.role}</span>}
              {(editable || m.userId === user.id) && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="text-red-600">{m.userId === user.id ? "Leave" : "Remove"}</button>
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
              <span className="flex-1 truncate">{i.email} · {i.role}</span>
              {canInvite && <button className="text-red-600">Revoke</button>}
            </form>
          ))}
        </div>
      )}
      {canInvite && (
        <div className="card">
          <p className="mb-3 text-sm font-semibold">Invite a member</p>
          <ActionForm action={inviteAction} submit="Send invitation">
            <Field name="email" label="Email" type="email" required />
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="EDITOR" className="input">
                {ROLES.filter((r) => canManageRole(role, r)).map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
