"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Shows a progress state while the worker renders, then refreshes the page to show the result. */
export function RenderProgress({ publicId, failed, labels }: { publicId: string; failed: boolean; labels: { working: string; failed: string } }) {
  const router = useRouter();
  useEffect(() => {
    if (failed) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/c/${publicId}/status`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r?.outputs?.includes("square") || r?.renderStatus === "FAILED") router.refresh();
      else setTimeout(tick, 1500);
    };
    const t = setTimeout(tick, 1000);
    return () => { stop = true; clearTimeout(t); };
  }, [publicId, failed, router]);
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-lg border bg-white p-6 text-center" role="status" aria-live="polite">
      {failed ? <p className="text-red-700">{labels.failed}</p> : (<><div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-brand-600" /><p>{labels.working}</p></>)}
    </div>
  );
}
