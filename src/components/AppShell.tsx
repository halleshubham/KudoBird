"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

export type NavItem = { href: string; label: string };

/** Primary navigation. The current section is marked visually and with aria-current. */
export function AppNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto px-1 text-sm">
      {items.map((n) => {
        const active = n.href === "/app" ? path === "/app" : path === n.href || path.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors ${active ? "bg-brand-50 text-brand-700" : "text-neutral-600 hover:bg-black/5 hover:text-neutral-900"}`}>{n.label}</Link>
        );
      })}
    </nav>
  );
}

/** Switching organisation is one step: choosing one submits. Hidden entirely when there is only one. */
export function OrgSwitcher({ orgs, current, action }: { orgs: { id: string; name: string }[]; current: string; action: (fd: FormData) => void | Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  if (orgs.length < 2) return <span className="max-w-[14rem] truncate text-sm font-medium text-neutral-700">{orgs[0]?.name}</span>;
  return (
    <form ref={form} action={action}>
      <select name="orgId" defaultValue={current} aria-label="Organisation" className="input !w-auto max-w-[14rem] !py-1.5" onChange={() => form.current?.requestSubmit()}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <noscript><button className="btn-ghost ml-2">Switch</button></noscript>
    </form>
  );
}

/** Account menu: who you are and how to leave, out of the way of the navigation. */
export function UserMenu({ email, role, logout }: { email: string; role: string; logout: () => void | Promise<void> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={menu} className="relative" onBlur={(e) => { if (!menu.current?.contains(e.relatedTarget as Node)) menu.current?.removeAttribute("open"); }}>
      <summary aria-label="Account menu" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold uppercase text-white [&::-webkit-details-marker]:hidden">{email[0]}</summary>
      <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-black/10 bg-white p-3 text-sm shadow-lg">
        <p className="truncate font-medium">{email}</p>
        <p className="mb-2 text-xs capitalize text-neutral-500">{role.toLowerCase()}</p>
        <form action={logout}><button className="btn-ghost w-full">Sign out</button></form>
      </div>
    </details>
  );
}
