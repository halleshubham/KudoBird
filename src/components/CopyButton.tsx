"use client";
import { useState } from "react";

/** Copies text and confirms it in place (announced politely to screen readers). */
export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked: the link is selectable text */ } }}>
      <span role="status">{done ? "Copied ✓" : label}</span>
    </button>
  );
}
