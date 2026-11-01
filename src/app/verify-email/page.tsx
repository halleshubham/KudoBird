import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import { resendVerificationAction } from "../actions";

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const email = ((await searchParams).email ?? "").trim().slice(0, 254);
  return (
    <AuthShell title="Check your inbox">
      <div className="space-y-2 text-sm">
        <p>{email ? <>We sent a verification link to <strong className="break-all">{email}</strong>.</> : "We sent you a verification link."} Open it to activate your account, then you can sign in.</p>
        <ul className="list-disc space-y-1 pl-5 text-neutral-600">
          <li>It can take a minute. Check your spam folder too.</li>
          <li>The link works for 24 hours.</li>
        </ul>
      </div>
      {email ? (
        <ActionForm fullWidth action={resendVerificationAction} submit="Send the link again" pendingLabel="Sending…">
          <input type="hidden" name="email" value={email} />
        </ActionForm>
      ) : null}
      <p className="flex justify-between text-sm">
        <Link href="/login" className="text-brand-700 underline">Back to sign in</Link>
        <Link href="/signup" className="text-brand-700 underline">Use a different email</Link>
      </p>
    </AuthShell>
  );
}
