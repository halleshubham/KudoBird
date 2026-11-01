import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { acceptInvite, OrgError } from "@/server/orgs";
import { currentSession } from "@/server/session";
import { AuthShell, Notice } from "@/components/AuthShell";

export default async function AcceptInvite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const session = await currentSession();
  if (!token) redirect("/login");
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
  try {
    const { orgId } = await acceptInvite(token, session.user);
    await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: orgId } });
  } catch (e) {
    if (e instanceof OrgError) return <AuthShell title="Invitation"><Notice kind="error">{e.message}</Notice></AuthShell>;
    throw e;
  }
  redirect("/app");
}
