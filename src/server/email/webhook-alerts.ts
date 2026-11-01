import * as React from "react";
import { withPlatform } from "../db";
import { appUrl } from "../urls";
import { deliver } from "./notifications";
import { ActionEmail } from "./templates";

/** Tell an organisation's owners and admins that a webhook endpoint was switched off automatically. */
export async function alertWebhookDisabled(orgId: string, url: string, failures: number) {
  const owners = await withPlatform((tx) => tx.membership.findMany({ where: { orgId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true } }));
  for (const o of owners) {
    await deliver({
      orgId, kind: "WEBHOOK_ALERT", to: o.user.email, contributor: false, subject: "A webhook endpoint was switched off",
      react: React.createElement(ActionEmail, { preview: "Webhook switched off", heading: "A webhook endpoint was switched off", body: `${url} failed ${failures} deliveries in a row, so KudoBird stopped sending to it. Fix the receiver, then re-enable it under Developers.`, actionLabel: "Open Developers", actionUrl: appUrl("/app/developers") }),
    });
  }
}
