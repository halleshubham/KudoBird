import QRCode from "qrcode";
import { AuthShell } from "@/components/AuthShell";
import { ActionForm, Field } from "@/components/ActionForm";
import { currentSession } from "@/server/session";
import { redirect } from "next/navigation";
import { startTotpSetup, verifyTotpAction } from "../actions";

export default async function TwoFactor() {
  const session = await currentSession();
  if (!session) redirect("/login");
  const enrolled = !!session.user.totpEnabledAt;
  const setup = enrolled ? null : await startTotpSetup();
  const qr = setup ? await QRCode.toDataURL(setup.otpauthUrl) : null;
  return (
    <AuthShell title={enrolled ? "Enter your authenticator code" : "Set up two-factor authentication"}>
      {qr && (
        <div className="space-y-2 text-sm">
          <p>Scan with Google Authenticator, Authy or similar, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="2FA QR code" width={180} height={180} />
          <p className="break-all text-xs text-neutral-500">Or enter manually: {setup!.secret}</p>
        </div>
      )}
      <ActionForm action={verifyTotpAction} submit="Verify">
        <Field name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" required />
      </ActionForm>
    </AuthShell>
  );
}
