"use client";
import { useActionState } from "react";
import { ConfirmButton } from "./ConfirmButton";

type State = { error?: string; info?: string } | undefined;

/** A single-purpose button/form posting hidden fields to a server action, with optional confirmation dialog and inline result. */
export function ActionButton({ action, fields = {}, label, confirm, confirmLabel, className, danger, children }: {
  action: (s: State, fd: FormData) => Promise<State>; fields?: Record<string, string>; label: string; confirm?: string; confirmLabel?: string; className?: string; danger?: boolean; children?: React.ReactNode;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  const style = danger ? "btn-link-danger" : "btn-ghost !px-2 !py-1 text-sm";
  return (
    <form action={act} className={`inline-flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {confirm ? (
        <ConfirmButton message={confirm} title={label} confirmLabel={confirmLabel ?? label} danger={danger} className={style}>{label}</ConfirmButton>
      ) : (
        <button disabled={pending} className={style}>{pending ? "…" : label}</button>
      )}
      {state?.error && <span className="text-xs text-red-700" role="alert">{state.error}</span>}
      {state?.info && <span className="text-xs text-green-700" role="status">{state.info}</span>}
    </form>
  );
}
