import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { forgotAction } from "../actions";

export default function Forgot() {
  return (
    <AuthShell title="Reset your password">
      <ActionForm fullWidth action={forgotAction} submit="Send reset link">
        <Field name="email" label="Email" type="email" required />
      </ActionForm>
    </AuthShell>
  );
}
