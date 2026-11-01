"use client";
import { useActionState, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { DevState } from "./actions";

/** A form whose server action may return a secret. The secret is displayed once, with a copy button, and then forgotten. */
export function RevealForm({ action, submit, children, className, confirm, quiet }: { action: (s: DevState, fd: FormData) => Promise<DevState>; submit: string; children?: React.ReactNode; className?: string; confirm?: string; quiet?: boolean }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={act} className={className ?? "space-y-3"}>
      {children}
      {confirm ? (
        <ConfirmButton message={confirm} title={submit} confirmLabel={submit} danger className={quiet ? "btn-link-danger" : "btn-danger"}>{submit}</ConfirmButton>
      ) : (
        <button className={quiet ? "btn-ghost !px-2 !py-1 text-sm" : "btn"} disabled={pending}>{pending ? "Working…" : submit}</button>
      )}
      {state?.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{state.error}</p>}
      {state?.info && <p className="text-sm text-green-800" role="status">{state.info}</p>}
      {state?.reveal && (
        <div className="rounded border-2 border-amber-400 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">{state.reveal.label}</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs">{state.reveal.value}</code>
          <button type="button" className="btn-ghost mt-2" onClick={async () => { try { await navigator.clipboard.writeText(state.reveal!.value); setCopied(true); } catch { /* select manually */ } }}>{copied ? "Copied ✓" : "Copy"}</button>
          <p className="mt-2 text-xs text-amber-900">Store it somewhere safe. For your security we keep only a fingerprint, so we cannot show it again.</p>
        </div>
      )}
    </form>
  );
}
