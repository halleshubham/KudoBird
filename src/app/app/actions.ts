"use server";
import { revalidatePath } from "next/cache";
import { toActionState, type ActionState } from "@/app/_lib/action-errors";
import { z } from "zod";
import { Role } from "@prisma/client";

import { changeMemberRole, inviteMember, removeMember, revokeInvite, updateOrganization, setNotificationMode } from "@/server/orgs";
import { requireOrg } from "@/server/session";

type State = ActionState;
const fail = toActionState;

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
  await setNotificationMode(ctx, z.enum(["INSTANT", "DAILY", "OFF"]).parse(fd.get("mode")));
  revalidatePath("/app/settings");
}

export async function setOrgLogoAction(assetId: string | null): Promise<{ error?: string }> {
  try {
    const { ctx } = await requireOrg("org.update");
    await updateOrganization(ctx, { logoAssetId: assetId });
    revalidatePath("/app", "layout");
    return {};
  } catch (e) { return { error: fail(e)?.error ?? "Something went wrong" }; }
}
