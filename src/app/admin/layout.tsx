import Link from "next/link";
import { getPlatformSettings } from "@/server/platform-settings";
import { requireSuperAdmin } from "@/server/session";
import { logoutAction } from "../actions";

const NAV = [["/admin", "Overview"], ["/admin/orgs", "Organisations"], ["/admin/users", "Users"], ["/admin/plans", "Plans"], ["/admin/templates", "Templates"], ["/admin/fonts", "Fonts"], ["/admin/settings", "Settings"], ["/admin/audit", "Audit"]] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  const s = await getPlatformSettings();
  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 bg-neutral-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <span className="font-bold">KudoBird · Platform admin</span>
          <nav className="flex flex-wrap gap-3">{NAV.map(([href, label]) => <Link key={href} href={href} className="text-neutral-200 hover:text-white">{label}</Link>)}</nav>
          <form action={logoutAction} className="ml-auto"><span className="mr-3 text-neutral-400">{user.email}</span><button className="underline">Sign out</button></form>
        </div>
        {!s.signupsOpen && <p className="bg-amber-500 px-4 py-1 text-center text-xs text-black">New sign-ups are currently closed.</p>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
