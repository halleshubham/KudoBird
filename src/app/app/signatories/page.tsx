import { ActionForm, Field } from "@/components/ActionForm";
import { listSignatories } from "@/server/campaigns/service";
import { can } from "@/server/permissions";
import { requireOrg } from "@/server/session";
import { createSignatoryAction, deleteSignatoryAction } from "../campaigns/actions";
import { SignatureUpload } from "./SignatureUpload";

export default async function Signatories() {
  const { ctx, role } = await requireOrg("campaigns.view");
  const list = await listSignatories(ctx);
  const manage = can(role, "signatories.manage");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Signatories</h1>
      <p className="text-sm text-neutral-600">Your organisation&apos;s reusable signatories. Choose which ones appear, and in what order, in each campaign&apos;s certificate design. Use a PNG signature with a transparent background.</p>
      <div className="card divide-y">
        {list.length === 0 && <p className="text-sm text-neutral-600">No signatories yet.</p>}
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-2 text-sm">
            {s.assetId ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${s.assetId}`} alt="" className="h-10 w-24 rounded border bg-white object-contain" /> : <div className="h-10 w-24 rounded border bg-neutral-50" />}
            <div className="flex-1"><p className="font-medium">{s.name}</p><p className="text-neutral-500">{s.designation}</p></div>
            {manage && <form action={deleteSignatoryAction}><input type="hidden" name="id" value={s.id} /><button className="text-red-600">Delete</button></form>}
          </div>
        ))}
      </div>
      {manage && (
        <div className="card max-w-md">
          <p className="mb-3 text-sm font-semibold">Add signatory</p>
          <ActionForm action={createSignatoryAction} submit="Add signatory">
            <Field name="name" label="Name" required />
            <Field name="designation" label="Designation" required />
            <SignatureUpload />
          </ActionForm>
        </div>
      )}
    </div>
  );
}
