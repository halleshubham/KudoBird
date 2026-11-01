import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { listUserOrgs } from "@/server/orgs";
import { requireUser } from "@/server/session";

export default async function Suspended() {
  const { user } = await requireUser();
  const orgs = await listUserOrgs(user.id);
  if (orgs.length === 0) redirect("/onboarding");
  if (orgs.some((o) => o.org.status === "ACTIVE")) redirect("/app");
  return (
    <AuthShell title="Workspace unavailable">
      <p className="text-sm">{orgs.length === 1 ? `The workspace “${orgs[0].org.name}” is` : "Your workspaces are"} currently suspended, so it cannot be used right now. Public certificate pages that were already issued keep working.</p>
      <p className="text-sm text-neutral-600">If you think this is a mistake, contact support.</p>
      <form action="/auth/logout" method="post"><button className="btn-ghost w-full">Sign out</button></form>
      <p className="text-center text-sm"><Link href="/onboarding" className="text-brand-700">Create a new workspace</Link></p>
    </AuthShell>
  );
}
