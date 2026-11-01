"use client";
import { useEffect } from "react";

/** Tells the embedding page how tall the form is, so the iframe can fit it without a scrollbar. */
export function EmbedResizer() {
  useEffect(() => {
    // Measure the form's own container. NOT documentElement.scrollHeight or <body>: both are at least as tall as the iframe
    // (the root layout is min-h-screen), so the frame could never shrink and would grow on every message.
    const content = () => document.querySelector("main");
    const send = () => {
      const el = content();
      if (el && window.parent !== window) window.parent.postMessage({ type: "kudobird:resize", height: Math.ceil(el.getBoundingClientRect().height) }, "*");
    };
    const ro = new ResizeObserver(send);
    const el = content(); if (el) ro.observe(el);
    send();
    return () => ro.disconnect();
  }, []);
  return null;
}
