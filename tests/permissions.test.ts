import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { can, canManageRole, PERMISSIONS } from "@/server/permissions";
import { changeMemberRole, inviteMember, listAuditLog, removeMember, updateOrganization, type OrgContext } from "@/server/orgs";
import { consoleOutbox } from "@/server/email";
import { prisma } from "@/server/db";
import { cleanup, makeOrg } from "./helpers";

describe("permission matrix", () => {
  const roles: Role[] = ["VIEWER", "EDITOR", "ADMIN", "OWNER"];
  it("roles are strictly cumulative", () => {
    for (let i = 1; i < roles.length; i++) {
      for (const p of PERMISSIONS) if (can(roles[i - 1], p)) expect(can(roles[i], p), `${roles[i]} ${p}`).toBe(true);
    }
  });
  it("viewer is read-only", () => {
    expect(can("VIEWER", "entries.view")).toBe(true);
    expect(can("VIEWER", "stats.view")).toBe(true);
    for (const p of ["campaigns.manage", "entries.manage", "members.manage", "org.update", "org.billing"] as const) expect(can("VIEWER", p)).toBe(false);
  });
  it("editor manages campaigns, designs and entries but not members/signatories/settings", () => {
    expect(can("EDITOR", "campaigns.manage")).toBe(true);
    expect(can("EDITOR", "templates.manage")).toBe(true);
    expect(can("EDITOR", "entries.manage")).toBe(true);
    expect(can("EDITOR", "members.manage")).toBe(false);
    expect(can("EDITOR", "signatories.manage")).toBe(false);
    expect(can("EDITOR", "org.update")).toBe(false);
  });
  it("admin manages members (not owners); only owner has billing/delete", () => {
    expect(can("ADMIN", "members.manage")).toBe(true);
    expect(can("ADMIN", "members.manage_owner")).toBe(false);
    expect(can("ADMIN", "org.billing")).toBe(false);
    expect(can("OWNER", "org.billing")).toBe(true);
    expect(can("OWNER", "org.delete")).toBe(true);
    expect(can(null, "org.view")).toBe(false);
  });
  it("canManageRole: admins cannot create or modify owners, nor outrank themselves", () => {
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(true);
    expect(canManageRole("ADMIN", "VIEWER")).toBe(true);
    expect(canManageRole("OWNER", "OWNER")).toBe(true);
    expect(canManageRole("EDITOR", "VIEWER")).toBe(false);
  });
});

describe("role enforcement in services", () => {
  let T: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  });
  afterAll(async () => {
    await cleanup([T.org.id], T.members.map((m) => m.userId));
    await prisma.$disconnect();
  });
  const c = (r: Role) => T.ctx(r) as OrgContext;

  it("viewer and editor cannot invite; admin and owner can", async () => {
    await expect(inviteMember(c("VIEWER"), "a@x.test", "VIEWER")).rejects.toThrow(/Forbidden/);
    await expect(inviteMember(c("EDITOR"), "a@x.test", "VIEWER")).rejects.toThrow(/Forbidden/);
    await expect(inviteMember(c("ADMIN"), "a@x.test", "EDITOR")).resolves.toBeTruthy();
    await expect(inviteMember(c("OWNER"), "b@x.test", "ADMIN")).resolves.toBeTruthy();
    expect(consoleOutbox().some((m) => m.to === "a@x.test")).toBe(true);
  });
  it("admin cannot invite an owner", async () => {
    await expect(inviteMember(c("ADMIN"), "o@x.test", "OWNER")).rejects.toThrow(/Forbidden/);
  });
  it("admin cannot change or remove the owner; viewer cannot update org", async () => {
    await expect(changeMemberRole(c("ADMIN"), T.owner.id, "VIEWER")).rejects.toThrow(/Forbidden/);
    await expect(removeMember(c("ADMIN"), T.owner.id)).rejects.toThrow(/Forbidden/);
    await expect(updateOrganization(c("VIEWER"), { name: "x" })).rejects.toThrow(/Forbidden/);
    await expect(updateOrganization(c("ADMIN"), { primaryColor: "#112233" })).resolves.toBeTruthy();
  });
  it("the last owner cannot be demoted or removed", async () => {
    await expect(changeMemberRole(c("OWNER"), T.owner.id, "ADMIN")).rejects.toThrow(/at least one owner/);
    await expect(removeMember(c("OWNER"), T.owner.id)).rejects.toThrow(/at least one owner/);
  });
  it("audit log is visible to admin/owner only and records the actions", async () => {
    await expect(listAuditLog(c("EDITOR"))).rejects.toThrow(/Forbidden/);
    const log = await listAuditLog(c("ADMIN"));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["org.created", "member.invited", "org.updated"]));
  });
});
