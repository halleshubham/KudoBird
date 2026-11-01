import Link from "next/link";
import { Logo } from "@/components/Logo";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { logoutAction, switchOrgAction } from "../actions";
import { stopSupportAction } from "../admin/actions";
import { getPlatformSettings } from "@/server/platform-settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ctx, orgs, role } = await requireOrg();
  const announcement = (await getPlatformSettings()).announcement;
  const nav = [
    { href: "/app", label: "Dashboard", show: true },
    { href: "/app/campaigns", label: "Campaigns", show: can(role, "campaigns.view") },
    { href: "/app/signatories", label: "Signatories", show: can(role, "campaigns.view") },
    { href: "/app/members", label: "Members", show: can(role, "members.view") },
    { href: "/app/developers", label: "Developers", show: can(role, "apikeys.manage") },
    { href: "/app/settings", label: "Settings", show: can(role, "org.view") },
    { href: "/app/audit", label: "Audit log", show: can(role, "audit.view") },
  ].filter((n) => n.show);
  return (
    <div className="min-h-screen">
      {ctx.impersonatorId && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          <span>Support access: a KudoBird administrator is acting as {user.email} (limited to this workspace, expires within an hour). Everything is logged.</span>
          <form action={stopSupportAction} className="ml-3 inline"><button className="rounded bg-amber-900 px-2 py-0.5 text-white">End support session</button></form>
        </div>
      )}
      {announcement && <div className="bg-brand-50 px-4 py-2 text-center text-sm text-brand-700" role="status">{announcement}</div>}
      <header className="sticky top-0 z-10 border-b border-black/10 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/app" className="text-lg"><Logo /></Link>
          <form action={switchOrgAction}>
            <select name="orgId" defaultValue={ctx.orgId} className="input !w-auto" aria-label="Organisation">
              {orgs.map((o) => <option key={o.org.id} value={o.org.id}>{o.org.name}</option>)}
            </select>
            <button className="btn-ghost ml-2">Switch</button>
          </form>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 font-medium text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900">{n.label}</Link>)}
          </nav>
          <form action={logoutAction} className="ml-auto text-sm">
            <span className="mr-3 text-neutral-500">{user.email} · {role.toLowerCase()}</span>
            <button className="font-medium text-brand-700 hover:underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
