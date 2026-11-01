"use client";
import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Notice } from "./AuthShell";

type State = { error?: string; info?: string } | undefined;

/** Submit button that shows progress and blocks double submits. Use inside any <form action={...}>. */
export function SubmitButton({ children, pendingLabel = "Saving…", className = "btn" }: { children: React.ReactNode; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Form wired to a server action with inline error/info feedback (announced to screen readers). */
export function ActionForm({ action, children, submit, pendingLabel, className, fullWidth = false }: {
  action: (s: State, fd: FormData) => Promise<State>;
  children: React.ReactNode;
  submit: string;
  pendingLabel?: string;
  className?: string;
  /** Primary buttons are full width only in narrow auth cards; elsewhere they hug their label. */
  fullWidth?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      {state?.info && <Notice kind="info">{state.info}</Notice>}
      {children}
      <SubmitButton className={fullWidth ? "btn w-full" : "btn"} pendingLabel={pendingLabel}>{submit}</SubmitButton>
    </form>
  );
}

/** Labelled input. `hint` is read with the field; required fields are marked visibly and to assistive tech. */
export function Field({ name, label, type = "text", hint, ...rest }: { name: string; label: string; type?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{rest.required && <span className="ml-0.5 text-red-600" aria-hidden> *</span>}</label>
      <input id={name} name={name} type={type} className="input" aria-describedby={hint ? hintId : undefined} {...rest} />
      {hint && <p id={hintId} className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
