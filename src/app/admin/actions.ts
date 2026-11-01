"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AdminError } from "@/server/admin/guard";
import { startImpersonation } from "@/server/admin/impersonation";
import { createGlobalTemplate, deleteGlobalTemplate, precacheFont, renameGlobalTemplate, saveGlobalTemplateDesign, setFontCurated, syncFonts, updateSettings, upsertPlan } from "@/server/admin/content";
import { createOrgForOwner, purgeOrg, restoreOrg, setOrgOverrides, setOrgPlan, setOrgStatus, softDeleteOrg } from "@/server/admin/orgs";
import { resetUserTotp, sendUserPasswordReset, setSuperAdmin, setUserDisabled } from "@/server/admin/users";
import { FEATURE_KEYS, LIMIT_KEYS } from "@/server/entitlements";
import { PRESETS } from "@/server/render/presets";
import { enterSupportSession, leaveSupportSession, requireSuperAdmin } from "@/server/session";
import { currentSession } from "@/server/session";

export type AdminState = { error?: string; info?: string } | undefined;

const fail = (e: unknown): AdminState => {
  if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
  if (e instanceof AdminError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0] ? `${e.issues[0].path.join(".") || "input"}: ${e.issues[0].message}` : "Invalid input" };
  if (e instanceof SyntaxError) return { error: "That is not valid JSON" };
  console.error(e);
  return { error: "Something went wrong" };
};

/** Every action authenticates on its own (never relies on the page it was rendered in). */
async function run(path: string | null, fn: (adminId: string) => Promise<string | void>): Promise<AdminState> {
  try {
    const admin = await requireSuperAdmin();
    const info = await fn(admin.id);
    if (path) revalidatePath(path, "layout");
    return { info: info || "Done" };
  } catch (e) { return fail(e); }
}

const id = (fd: FormData, k = "id") => z.string().uuid().parse(fd.get(k));

// ---- organisations
export async function createOrgAction(_: AdminState, fd: FormData) {
  return run("/admin/orgs", async (a) => {
    const v = z.object({ name: z.string(), ownerEmail: z.string(), planKey: z.string().optional() }).parse(Object.fromEntries(fd));
    const r = await createOrgForOwner(a, { ...v, planKey: v.planKey || undefined });
    return r.invited ? `Created. An owner invitation was emailed to ${v.ownerEmail}.` : `Created. ${v.ownerEmail} is now the owner.`;
  });
}
export async function setPlanAction(_: AdminState, fd: FormData) { return run("/admin/orgs", (a) => setOrgPlan(a, id(fd), String(fd.get("planKey"))).then(() => "Plan changed")); }
export async function setOverridesAction(_: AdminState, fd: FormData) {
  return run("/admin/orgs", async (a) => {
    const num = (k: string) => { const v = String(fd.get(`limit_${k}`) ?? "").trim(); return v === "" ? null : Number(v); };
    const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, num(k)]));
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => { const v = String(fd.get(`feature_${k}`) ?? "inherit"); return [k, v === "inherit" ? null : v === "on"]; }));
    await setOrgOverrides(a, id(fd), { limits, features });
    return "Overrides saved";
  });
}
export async function suspendAction(_: AdminState, fd: FormData) { return run("/admin/orgs", (a) => setOrgStatus(a, id(fd), "SUSPENDED", String(fd.get("reason") ?? "")).then(() => "Suspended")); }
export async function unsuspendAction(_: AdminState, fd: FormData) { return run("/admin/orgs", (a) => setOrgStatus(a, id(fd), "ACTIVE").then(() => "Reactivated")); }
export async function deleteOrgAction(_: AdminState, fd: FormData) { return run("/admin/orgs", (a) => softDeleteOrg(a, id(fd)).then(() => "Organisation deleted (recoverable until purged)")); }
export async function restoreOrgAction(_: AdminState, fd: FormData) { return run("/admin/orgs", (a) => restoreOrg(a, id(fd)).then(() => "Restored")); }
export async function purgeOrgAction(_: AdminState, fd: FormData) {
  return run("/admin/orgs", async (a) => { const r = await purgeOrg(a, id(fd), String(fd.get("confirm") ?? "")); return `Purged "${r.slug}" and ${r.purgedFiles} files`; });
}

// ---- users
export async function disableUserAction(_: AdminState, fd: FormData) { return run("/admin/users", (a) => setUserDisabled(a, id(fd, "userId"), fd.get("disable") === "1").then(() => "Updated")); }
export async function promoteAction(_: AdminState, fd: FormData) { return run("/admin/users", (a) => setSuperAdmin(a, id(fd, "userId"), fd.get("on") === "1").then(() => "Updated")); }
export async function resetTotpAction(_: AdminState, fd: FormData) { return run("/admin/users", (a) => resetUserTotp(a, id(fd, "userId")).then(() => "2FA reset; the user was signed out")); }
export async function resetPasswordAction(_: AdminState, fd: FormData) { return run(null, (a) => sendUserPasswordReset(a, id(fd, "userId")).then(() => "Reset link emailed")); }

// ---- support access
export async function startSupportAction(_: AdminState, fd: FormData): Promise<AdminState> {
  try {
    const admin = await requireSuperAdmin();
    const session = await startImpersonation(admin.id, { orgId: id(fd, "orgId"), userId: id(fd, "userId"), reason: String(fd.get("reason") ?? "") });
    await enterSupportSession(session);
  } catch (e) { return fail(e); }
  redirect("/app");
}
/** Available to any signed-in support session (not only admins), because that session belongs to the target user. */
export async function stopSupportAction() {
  const s = await currentSession();
  if (!s?.impersonatorId) redirect("/app");
  const to = await leaveSupportSession();
  redirect(to === "admin" ? "/admin/orgs" : "/login");
}

// ---- plans / settings / templates / fonts
export async function savePlanAction(_: AdminState, fd: FormData) {
  return run("/admin/plans", async (a) => {
    const limits: Record<string, number> = {};
    for (const k of LIMIT_KEYS) { const v = String(fd.get(`limit_${k}`) ?? "").trim(); if (v !== "") limits[k] = Number(v); }
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, fd.get(`feature_${k}`) === "on"]));
    await upsertPlan(a, { key: String(fd.get("key")), name: String(fd.get("name")), limits, features, isDefault: fd.get("isDefault") === "on", active: fd.get("active") === "on" });
    return "Plan saved. Organisations on this plan use the new limits immediately.";
  });
}
export async function saveSettingsAction(_: AdminState, fd: FormData) {
  return run("/admin", (a) => updateSettings(a, { signupsOpen: fd.get("signupsOpen") === "on", defaultPlanKey: String(fd.get("defaultPlanKey")), announcement: String(fd.get("announcement") ?? "") }).then(() => "Settings saved"));
}
export async function createTemplateAction(_: AdminState, fd: FormData) {
  return run("/admin/templates", (a) => createGlobalTemplate(a, { name: String(fd.get("name")), preset: z.enum(PRESETS).parse(fd.get("preset")), locale: z.enum(["en", "hi", "mr"]).parse(fd.get("locale")) }).then(() => "Template created"));
}
export async function saveTemplateDesignAction(_: AdminState, fd: FormData) {
  return run("/admin/templates", (a) => saveGlobalTemplateDesign(a, id(fd), String(fd.get("design"))).then((r) => `Saved as version ${r.version}`));
}
export async function renameTemplateAction(_: AdminState, fd: FormData) { return run("/admin/templates", (a) => renameGlobalTemplate(a, id(fd), String(fd.get("name")), String(fd.get("description") ?? "")).then(() => "Renamed")); }
export async function deleteTemplateAction(_: AdminState, fd: FormData) { return run("/admin/templates", (a) => deleteGlobalTemplate(a, id(fd)).then(() => "Deleted")); }
export async function curateFontAction(_: AdminState, fd: FormData) { return run("/admin/fonts", (a) => setFontCurated(a, String(fd.get("family")), fd.get("curated") === "1").then(() => "Updated")); }
export async function syncFontsAction(): Promise<AdminState> { return run("/admin/fonts", (a) => syncFonts(a).then((n) => `Synced ${n} fonts`)); }
export async function precacheFontAction(_: AdminState, fd: FormData) { return run("/admin/fonts", (a) => precacheFont(a, String(fd.get("family"))).then((r) => `Cached ${r.files} files`)); }
