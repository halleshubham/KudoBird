"use client";
import { useActionState } from "react";

type State = { error?: string; info?: string } | undefined;

/** A single-purpose button/form posting hidden fields to a server action, with optional confirmation and inline result. */
export function ActionButton({ action, fields = {}, label, confirm, className, danger, children }: {
  action: (s: State, fd: FormData) => Promise<State>; fields?: Record<string, string>; label: string; confirm?: string; className?: string; danger?: boolean; children?: React.ReactNode;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className={`inline-flex flex-wrap items-center gap-2 ${className ?? ""}`} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button disabled={pending} className={danger ? "text-red-600 underline" : "btn-ghost !px-2 !py-1 text-sm"}>{pending ? "…" : label}</button>
      {state?.error && <span className="text-xs text-red-700" role="alert">{state.error}</span>}
      {state?.info && <span className="text-xs text-green-700" role="status">{state.info}</span>}
    </form>
  );
}
