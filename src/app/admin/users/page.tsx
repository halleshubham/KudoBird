import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { listUsers } from "@/server/admin/users";
import { requireSuperAdmin } from "@/server/session";
import { disableUserAction, promoteAction, resetPasswordAction, resetTotpAction } from "../actions";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const admin = await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listUsers(admin.id, { q: sp.q, page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const q = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <form className="flex gap-2 text-sm"><input name="q" defaultValue={sp.q} placeholder="Search email or name" className="input !w-72" /><button className="btn-ghost">Search</button><span className="self-center text-gray-500">{list.total} users</span></form>
      <div className="card divide-y">
        {list.rows.map((u) => (
          <div key={u.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{u.name ?? u.email}</span><span className="text-gray-500">{u.email}</span>
              {u.isSuperAdmin && <span className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white">platform admin</span>}
              {u.disabled && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">disabled</span>}
              {!u.verified && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">unverified</span>}
              <span className="text-xs text-gray-500">{u.twoFactor ? "2FA on" : "2FA off"}</span>
            </div>
            <p className="text-xs text-gray-600">{u.orgs.length === 0 ? "No organisations" : u.orgs.map((o) => <span key={o.id} className="mr-2"><Link className="text-brand-700 underline" href={`/admin/orgs/${o.id}`}>{o.name}</Link> ({o.role.toLowerCase()}{o.status !== "ACTIVE" ? ", suspended" : ""})</span>)}</p>
            <div className="flex flex-wrap gap-2">
              {u.id !== admin.id && <ActionButton action={disableUserAction} fields={{ userId: u.id, disable: u.disabled ? "0" : "1" }} label={u.disabled ? "Enable" : "Disable"} confirm={u.disabled ? undefined : `Disable ${u.email}? They are signed out everywhere.`} />}
              <ActionButton action={resetPasswordAction} fields={{ userId: u.id }} label="Send password reset" />
              {u.id !== admin.id && u.twoFactor && <ActionButton action={resetTotpAction} fields={{ userId: u.id }} label="Reset 2FA" confirm={`Reset two-factor authentication for ${u.email}?`} />}
              {u.id !== admin.id && <ActionButton action={promoteAction} fields={{ userId: u.id, on: u.isSuperAdmin ? "0" : "1" }} label={u.isSuperAdmin ? "Remove admin" : "Make platform admin"} confirm={u.isSuperAdmin ? undefined : `Give ${u.email} full platform administrator powers?`} />}
            </div>
          </div>
        ))}
      </div>
      <nav className="flex gap-3 text-sm">{page > 1 && <Link className="text-brand-700 underline" href={q(page - 1)}>← Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="text-brand-700 underline" href={q(page + 1)}>Next →</Link>}</nav>
    </div>
  );
}
