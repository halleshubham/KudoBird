"use client";
import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * A button that asks for confirmation in an accessible modal (native <dialog>: focus trap, Esc to cancel, backdrop) before acting.
 * Inside a form it submits that form on confirm; elsewhere pass `onConfirm`. State the consequence in `message`, name the action in `confirmLabel`.
 */
export function ConfirmButton({ message, title = "Are you sure?", confirmLabel = "Confirm", danger, className, onConfirm, name, value, children }: {
  /** With `name`/`value`, the confirmed submit carries that pair, like a normal submit button would. */
  name?: string; value?: string;
  message: string; title?: string; confirmLabel?: string; danger?: boolean; className?: string; onConfirm?: () => void; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const submitter = useRef<HTMLButtonElement>(null);
  const { pending } = useFormStatus();
  const titleId = useId();
  const confirm = () => {
    dialog.current?.close();
    if (onConfirm) onConfirm();
    else if (submitter.current?.form) submitter.current.form.requestSubmit(submitter.current);
    else trigger.current?.form?.requestSubmit();
  };
  return (
    <>
      <button ref={trigger} type="button" className={className} disabled={pending} onClick={() => dialog.current?.showModal()}>{pending ? "…" : children}</button>
      {name && <button ref={submitter} type="submit" name={name} value={value} hidden tabIndex={-1} aria-hidden />}
      <dialog ref={dialog} aria-labelledby={titleId} className="w-[min(92vw,26rem)] rounded-2xl border border-black/10 p-0 shadow-xl backdrop:bg-black/40">
        <div className="space-y-2 p-5">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-neutral-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-black/10 bg-neutral-50 p-3">
          <button type="button" autoFocus className="btn-ghost" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className={danger ? "btn-danger" : "btn"} onClick={confirm}>{confirmLabel}</button>
        </div>
      </dialog>
    </>
  );
}
