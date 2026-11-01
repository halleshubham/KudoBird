import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { listFontsAdmin } from "@/server/admin/content";
import { requireSuperAdmin } from "@/server/session";
import { curateFontAction, precacheFontAction, syncFontsAction } from "../actions";

export default async function AdminFonts({ searchParams }: { searchParams: Promise<{ q?: string; curated?: string; page?: string }> }) {
  const admin = await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listFontsAdmin(admin.id, { q: sp.q, curatedOnly: sp.curated === "1", page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const q = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.curated ? { curated: "1" } : {}), page: String(p) })}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fonts</h1>
      <p className="max-w-2xl text-sm text-neutral-600">The designer shows the <strong>curated shortlist</strong> first and searches the rest of the catalogue ({list.catalogueSize} families). Bundled fonts ship with the app and always render offline. Other fonts are downloaded to the server on first use; pre-cache one here so its first render never waits on the network.</p>
      <div className="flex flex-wrap items-center gap-3"><ActionButton action={syncFontsAction} label="Sync catalogue from Google Fonts" /><span className="text-xs text-neutral-500">Refreshes metadata only; your curation is kept.</span></div>
      <form className="flex flex-wrap gap-2 text-sm"><input name="q" defaultValue={sp.q} placeholder="Search fonts" className="input !w-64" /><label className="flex items-center gap-1"><input type="checkbox" name="curated" value="1" defaultChecked={sp.curated === "1"} /> Curated only</label><button className="btn-ghost">Filter</button><span className="self-center text-neutral-500">{list.total} fonts</span></form>
      <div className="card divide-y text-sm">
        {list.rows.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-56 flex-1"><p className="font-medium">{f.family} {f.bundled && <span className="ml-1 rounded bg-green-100 px-1 text-xs text-green-800">bundled</span>} {f.curated && !f.bundled && <span className="ml-1 rounded bg-brand-100 px-1 text-xs text-brand-700">curated</span>}</p><p className="text-xs text-neutral-500">{f.category} · {f.subsets.join(", ")}</p></div>
            {!f.bundled && <ActionButton action={curateFontAction} fields={{ family: f.family, curated: f.curated ? "0" : "1" }} label={f.curated ? "Remove from shortlist" : "Add to shortlist"} />}
            <ActionButton action={precacheFontAction} fields={{ family: f.family }} label="Pre-cache" />
          </div>))}
      </div>
      <nav className="flex gap-3 text-sm">{page > 1 && <Link className="text-brand-700 underline" href={q(page - 1)}>← Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="text-brand-700 underline" href={q(page + 1)}>Next →</Link>}</nav>
    </div>
  );
}
