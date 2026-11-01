import type { Role } from "@prisma/client";

/** Single source of truth for what each org role can do. */
export const PERMISSIONS = [
  "org.view",
  "org.update",
  "org.billing",
  "org.delete",
  "members.view",
  "members.manage", // invite, change role, remove (non-owners)
  "members.manage_owner", // touch owner memberships
  "campaigns.manage", // create/update campaigns, designs
  "campaigns.view",
  "templates.manage",
  "signatories.manage",
  "entries.view",
  "entries.manage", // approve, reject, regenerate, revoke, resend
  "stats.view",
  "audit.view",
  "apikeys.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const viewer: Permission[] = ["org.view", "members.view", "campaigns.view", "entries.view", "stats.view"];
const editor: Permission[] = [...viewer, "campaigns.manage", "templates.manage", "entries.manage"];
const admin: Permission[] = [
  ...editor,
  "org.update",
  "signatories.manage",
  "members.manage",
  "audit.view",
  "apikeys.manage",
];
const owner: Permission[] = [...admin, "org.billing", "org.delete", "members.manage_owner"];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  VIEWER: new Set(viewer),
  EDITOR: new Set(editor),
  ADMIN: new Set(admin),
  OWNER: new Set(owner),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && MATRIX[role].has(permission);
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Forbidden: missing permission ${permission}`);
  }
}

export function assertCan(role: Role | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

/** Whether `actor` may assign or modify `target` role. Admins cannot touch owners. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (target === "OWNER") return can(actor, "members.manage_owner");
  return can(actor, "members.manage") && RANK[actor] >= RANK[target];
}
