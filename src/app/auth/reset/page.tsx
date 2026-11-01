import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { resetAction } from "../../actions";

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ActionForm fullWidth action={resetAction} submit="Set password">
        <input type="hidden" name="token" value={token ?? ""} />
        <Field name="password" label="New password" type="password" minLength={8} required />
      </ActionForm>
    </AuthShell>
  );
}
