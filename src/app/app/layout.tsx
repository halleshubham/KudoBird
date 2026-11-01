import Link from "next/link";
import { AppNav, OrgSwitcher, UserMenu } from "@/components/AppShell";
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
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
      <header className="sticky top-0 z-10 border-b border-black/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link href="/app" className="text-lg" aria-label="KudoBird home"><Logo /></Link>
          <OrgSwitcher orgs={orgs.map((o) => ({ id: o.org.id, name: o.org.name }))} current={ctx.orgId} action={switchOrgAction} />
          <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1"><AppNav items={nav} /></div>
          <div className="ml-auto md:ml-0"><UserMenu email={user.email} role={role} logout={logoutAction} /></div>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
