"use client";
import Script from "next/script";
import { useActionState, useState } from "react";
import { MESSAGES } from "@/i18n/messages";
import { sendOtpAction, submitPublicAction, verifyOtpAction, type PublicState } from "../../actions";

export interface PublicField { key: string; label: string; type: string; required: boolean; options: string[] }

export function PublicForm(p: {
  org: string; campaign: string; lang: string; fields: PublicField[]; dial: string; otp: boolean; consentRequired: boolean; consentText: string; purposeText: string;
  wall: boolean; captchaSiteKey?: string; accent: string; linkTarget?: "_blank";
}) {
  const m = MESSAGES[p.lang as keyof typeof MESSAGES] ?? MESSAGES.en;
  const [state, action, pending] = useActionState<PublicState | undefined, FormData>(submitPublicAction, undefined);
  const [otpToken, setOtpToken] = useState("");
  const [otpMsg, setOtpMsg] = useState<{ error?: string; info?: string }>();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const v = state?.values ?? {};
  const err = state?.errors ?? {};

  if (state?.ok) {
    return (
      <div className="space-y-3 text-center" role="status">
        <h2 className="text-xl font-bold">{m.thanksTitle}</h2>
        {state.status === "PENDING" ? <p>{m.thanksPending}</p> : <p><a className="inline-block rounded-md px-4 py-3 font-semibold text-white" style={{ background: p.accent }} href={`/c/${state.certificateId}`} target={p.linkTarget} rel={p.linkTarget ? "noopener" : undefined}>{m.viewCertificate}</a></p>}
      </div>
    );
  }
  const Err = ({ k }: { k: string }) => (err[k] ? <p className="mt-1 text-sm text-red-700" role="alert">{err[k]}</p> : null);
  const input = "w-full rounded-md border border-neutral-300 px-3 py-3 text-base";
  return (
    <form action={action} className="space-y-4" noValidate>
      {p.captchaSiteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
      <input type="hidden" name="org" value={p.org} /><input type="hidden" name="campaign" value={p.campaign} /><input type="hidden" name="lang" value={p.lang} />
      <input type="hidden" name="otpToken" value={otpToken} />
      {state?.error && <p className="rounded-md bg-red-50 p-3 text-red-700" role="alert">{state.error}</p>}
      <div><label htmlFor="name" className="mb-1 block font-medium">{m.fullName} *</label>
        <input id="name" name="name" autoComplete="name" defaultValue={v.name} className={input} required /><Err k="name" /></div>
      <div><label htmlFor="mobile" className="mb-1 block font-medium">{m.mobile} *</label>
        <div className="flex gap-2"><span className="flex items-center rounded-md border bg-neutral-50 px-3">{p.dial}</span>
          <input id="mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" defaultValue={v.mobile} onChange={(e) => setMobile(e.target.value)} className={input} required /></div>
        <Err k="mobile" />
        {p.otp && (
          <div className="mt-2 space-y-2">
            {!otpToken ? (<>
              <button type="button" className="rounded-md border px-3 py-2" onClick={async () => setOtpMsg(await sendOtpAction(p.org, p.campaign, mobile, p.lang))}>{m.sendOtp}</button>
              <div className="flex gap-2"><input aria-label={m.otpCode} placeholder={m.otpCode} inputMode="numeric" className={input} value={code} onChange={(e) => setCode(e.target.value)} />
                <button type="button" className="rounded-md border px-3" onClick={async () => { const r = await verifyOtpAction(p.org, p.campaign, mobile, code, p.lang); if ("token" in r && r.token) setOtpToken(r.token); setOtpMsg(r); }}>{m.verifyOtp}</button></div>
            </>) : <p className="text-green-700">✓ {m.otpVerified}</p>}
            {otpMsg?.error && <p className="text-sm text-red-700">{otpMsg.error}</p>}{otpMsg?.info && <p className="text-sm text-green-700">{otpMsg.info}</p>}
          </div>)}
      </div>
      <div><label htmlFor="email" className="mb-1 block font-medium">{m.email} <span className="text-neutral-500">({m.optional})</span></label>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={v.email} className={input} /><Err k="email" /></div>
      {p.fields.map((f) => (
        <div key={f.key}><label htmlFor={f.key} className="mb-1 block font-medium">{f.label}{f.required ? " *" : ` (${m.optional})`}</label>
          {f.type === "textarea" ? <textarea id={f.key} name={f.key} rows={3} defaultValue={v[f.key]} className={input} />
            : f.type === "select" ? <select id={f.key} name={f.key} defaultValue={v[f.key] ?? ""} className={input}><option value="">{m.selectPlaceholder}</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
            : <input id={f.key} name={f.key} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} defaultValue={v[f.key]} className={input} />}
          <Err k={f.key} /></div>
      ))}
      <p className="text-sm text-neutral-600">{p.purposeText}</p>
      {p.consentRequired && (<div><label className="flex items-start gap-2"><input type="checkbox" name="consent" defaultChecked={v.consent === "on"} className="mt-1 h-5 w-5" /> <span>{p.consentText}</span></label><Err k="consent" /></div>)}
      {p.wall && <label className="flex items-start gap-2"><input type="checkbox" name="wallOptIn" className="mt-1 h-5 w-5" /> <span>{m.wall}</span></label>}
      {p.captchaSiteKey && <div className="cf-turnstile" data-sitekey={p.captchaSiteKey} />}
      <button disabled={pending} style={{ background: p.accent }} className="w-full rounded-md px-4 py-3 text-lg font-semibold text-white disabled:opacity-60">{pending ? m.submitting : m.submit}</button>
    </form>
  );
}
