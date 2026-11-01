import { z } from "zod";
import { AdminError } from "@/server/admin/guard";
import { AuthError } from "@/server/auth";
import { EntitlementError } from "@/server/entitlements";
import { OrgError } from "@/server/orgs";
import { ForbiddenError } from "@/server/permissions";

export type ActionState = { error?: string; info?: string } | undefined;

/**
 * The one place that turns a thrown error into a message for a form. Order matters:
 *  1. Next's redirect() works by throwing, so it must be rethrown untouched or the redirect is swallowed.
 *  2. Expected domain errors show their own (already user-safe) message.
 *  3. Anything else is logged and shown generically, so internals never leak into the UI.
 */
export function toActionState(e: unknown): { error: string } {
  if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
  if (e instanceof ForbiddenError) return { error: "You do not have permission to do that" };
  if (e instanceof OrgError || e instanceof EntitlementError || e instanceof AuthError || e instanceof AdminError) return { error: e.message };
  if (e instanceof z.ZodError) {
    const i = e.issues[0];
    return { error: i ? (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message) : "Invalid input" };
  }
  if (e instanceof SyntaxError) return { error: "That is not valid JSON" };
  console.error(e);
  return { error: "Something went wrong" };
}
