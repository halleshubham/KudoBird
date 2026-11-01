import Link from "next/link";

/** Page title with optional supporting text and a primary action on the right (stacks on small screens). */
export function PageHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** What is empty, why, and the one action that fills it. */
export function EmptyState({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-neutral-600">{children}</p>}
      {href && cta && <Link href={href} className="btn mt-4">{cta}</Link>}
    </div>
  );
}

const TONE = { green: "bg-green-50 text-green-800", amber: "bg-amber-50 text-amber-800", neutral: "bg-neutral-100 text-neutral-700", blue: "bg-brand-50 text-brand-700" } as const;
/** Small status label. Never relies on colour alone: the text says it. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}
