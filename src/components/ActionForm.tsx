"use client";
import { useActionState } from "react";
import { Notice } from "./AuthShell";

type State = { error?: string; info?: string } | undefined;

/** Form wired to a server action with inline error/info feedback. */
export function ActionForm({ action, children, submit, className }: {
  action: (s: State, fd: FormData) => Promise<State>;
  children: React.ReactNode;
  submit: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      {state?.info && <Notice kind="info">{state.info}</Notice>}
      {children}
      <button className="btn w-full" disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}

export function Field({ name, label, type = "text", ...rest }: { name: string; label: string; type?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} className="input" {...rest} />
    </div>
  );
}
