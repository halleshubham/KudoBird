"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@prisma/client";
import { EntitlementError } from "@/server/entitlements";
import { ForbiddenError } from "@/server/permissions";
import { changeMemberRole, inviteMember, OrgError, removeMember, revokeInvite, updateOrganization } from "@/server/orgs";
import { requireOrg } from "@/server/session";
import { withTenant } from "@/server/db";
import { audit } from "@/server/audit";

type State = { error?: string; info?: string } | undefined;
const fail = (e: unknown): State => {
  if (e instanceof ForbiddenError) return { error: "You do not have permission to do that" };
  if (e instanceof OrgError || e instanceof EntitlementError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
  console.error(e);
  return { error: "Something went wrong" };
};

export async function inviteAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("members.manage");
    const { email, role } = z.object({ email: z.string().email(), role: z.nativeEnum(Role) }).parse(Object.fromEntries(fd));
    await inviteMember(ctx, email, role);
    revalidatePath("/app/members");
    return { info: `Invitation sent to ${email}` };
  } catch (e) { return fail(e); }
}

export async function changeRoleAction(fd: FormData) {
  const { ctx } = await requireOrg("members.manage");
  await changeMemberRole(ctx, String(fd.get("userId")), z.nativeEnum(Role).parse(fd.get("role")));
  revalidatePath("/app/members");
}

export async function removeMemberAction(fd: FormData) {
  const { ctx } = await requireOrg();
  await removeMember(ctx, String(fd.get("userId")));
  revalidatePath("/app/members");
}

export async function revokeInviteAction(fd: FormData) {
  const { ctx } = await requireOrg("members.manage");
  await revokeInvite(ctx, String(fd.get("inviteId")));
  revalidatePath("/app/members");
}

export async function updateOrgAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("org.update");
    const data = z.object({ name: z.string().trim().min(2).max(80), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be like #7c3aed") }).parse(Object.fromEntries(fd));
    await updateOrganization(ctx, data);
    revalidatePath("/app", "layout");
    return { info: "Saved" };
  } catch (e) { return fail(e); }
}

export async function setNotificationsAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const mode = z.enum(["INSTANT", "DAILY", "OFF"]).parse(fd.get("mode"));
  await withTenant(ctx, async (tx) => {
    await tx.membership.updateMany({ where: { orgId: ctx.orgId, userId: ctx.userId }, data: { entryNotifications: mode } });
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "member.notifications_changed", entity: "Membership", meta: { mode } });
  });
  revalidatePath("/app/settings");
}
