import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { signupAction } from "../actions";

export default function Signup() {
  return (
    <AuthShell title="Create your account. Free to start.">
      <ActionForm fullWidth action={signupAction} submit="Create account">
        <Field name="name" label="Your name" autoComplete="name" required />
        <Field name="email" label="Email" type="email" autoComplete="email" required />
        <Field name="password" label="Password (min 8 characters)" type="password" autoComplete="new-password" minLength={8} required />
      </ActionForm>
      <p className="text-sm text-neutral-600">Already registered? <Link href="/login" className="text-brand-700 underline">Sign in</Link></p>
    </AuthShell>
  );
}
