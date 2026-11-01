import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { googleEnabled } from "@/server/auth";
import { loginAction, magicLinkAction } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthShell title="Sign in to your workspace">
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <ActionForm action={loginAction} submit="Sign in">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field name="email" label="Email" type="email" autoComplete="email" required />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <details className="text-sm">
        <summary className="cursor-pointer text-brand-700">Email me a sign-in link instead</summary>
        <ActionForm action={magicLinkAction} submit="Send link" className="mt-3 space-y-3">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field name="email" label="Email" type="email" required />
        </ActionForm>
      </details>
      {googleEnabled() && <a href="/auth/google" className="btn-ghost w-full">Continue with Google</a>}
      <p className="flex justify-between text-sm text-neutral-600">
        <Link href="/forgot" className="text-brand-700">Forgot password?</Link>
        <Link href="/signup" className="text-brand-700">Create account</Link>
      </p>
    </AuthShell>
  );
}
