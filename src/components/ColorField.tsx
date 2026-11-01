"use client";
import { useState } from "react";

/** Colour picker and hex field kept in sync; submits the hex under `name`. */
export function ColorField({ name, label, defaultValue, hint }: { name: string; label: string; defaultValue: string; hint?: string }) {
  const [value, setValue] = useState(defaultValue);
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={valid ? value : "#000000"} onChange={(e) => setValue(e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border border-black/15 bg-white p-1" />
        <input id={name} name={name} value={value} onChange={(e) => setValue(e.target.value)} pattern="#[0-9a-fA-F]{6}" required className="input !w-32 font-mono" aria-invalid={!valid} />
        <span className="h-8 w-8 rounded-full border border-black/10" style={{ background: valid ? value : "transparent" }} aria-hidden />
      </div>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
