import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { listUserOrgs } from "@/server/orgs";
import { requireUser } from "@/server/session";
import { createOrgAction } from "../actions";

export default async function Onboarding() {
  const { user } = await requireUser();
  const mine = await listUserOrgs(user.id);
  if (mine.length > 0) redirect(mine.some((o) => o.org.status === "ACTIVE") ? "/app" : "/suspended");
  return (
    <AuthShell title="Name your organisation. This becomes your workspace.">
      <ActionForm action={createOrgAction} submit="Create workspace">
        <Field name="name" label="Organisation name" required />
      </ActionForm>
    </AuthShell>
  );
}
