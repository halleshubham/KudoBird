import Link from "next/link";
import { fmtTs } from "@/lib/format";
import { ActionButton } from "@/components/ActionButton";
import { Field } from "@/components/ActionForm";
import { listApiKeys } from "@/server/apikeys";
import { hasFeature } from "@/server/entitlements";
import { env } from "@/server/env";
import { listWebhookDeliveries, listWebhookEndpoints, WEBHOOK_EVENTS } from "@/server/webhooks";
import { requireOrg } from "@/server/session";
import { createKeyAction, createWebhookAction, deleteWebhookAction, redeliverAction, revokeKeyAction, rotateSecretAction, testWebhookAction, toggleWebhookAction } from "./actions";
import { RevealForm } from "./RevealForm";


export default async function Developers() {
  const { ctx } = await requireOrg("apikeys.manage");
  const [apiOn, hooksOn] = await Promise.all([hasFeature(ctx, "api"), hasFeature(ctx, "webhooks")]);
  const [keys, endpoints] = await Promise.all([listApiKeys(ctx), listWebhookEndpoints(ctx)]);
  const deliveries: Record<string, Awaited<ReturnType<typeof listWebhookDeliveries>>> = Object.fromEntries(await Promise.all(endpoints.map(async (e) => [e.id, await listWebhookDeliveries(ctx, e.id, 10)])));
  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold">Developers</h1>
        <p className="text-sm text-neutral-600">Connect KudoBird to your own systems. API reference: <Link className="text-brand-700 underline" href="/api/v1/openapi.json" target="_blank">OpenAPI document</Link> · base URL <code>{env().APP_URL}/api/v1</code></p></div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">API keys</h2>
        {!apiOn && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">API access is not included in your plan.</p>}
        <div className="card divide-y text-sm">
          {keys.length === 0 && <p className="text-neutral-500">No keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <div className="min-w-48 flex-1"><p className="font-medium">{k.name} {k.revokedAt && <span className="ml-1 rounded bg-neutral-200 px-1 text-xs">revoked</span>}</p>
                <p className="text-xs text-neutral-500"><code>kb_{k.prefix}_…</code> · {k.scopes.join(", ")} · last used {fmtTs(k.lastUsedAt)}{k.expiresAt ? ` · expires ${fmtTs(k.expiresAt)}` : ""}</p></div>
              {!k.revokedAt && <ActionButton action={revokeKeyAction} fields={{ id: k.id }} label="Revoke" danger confirm={`Revoke "${k.name}"? Anything using it stops working immediately.`} />}
            </div>))}
        </div>
        {apiOn && (
          <div className="card max-w-lg"><p className="mb-2 text-sm font-semibold">Create a key</p>
            <RevealForm action={createKeyAction} submit="Create key">
              <Field name="name" label="Name (e.g. the system that uses it)" required />
              <fieldset className="space-y-1 text-sm"><legend className="label">Permissions</legend>
                <label className="flex items-start gap-2"><input type="checkbox" name="scopes" value="read" defaultChecked className="mt-1" /> <span><strong>read</strong>: list campaigns, entries and certificates</span></label>
                <label className="flex items-start gap-2"><input type="checkbox" name="scopes" value="write" className="mt-1" /> <span><strong>write</strong>: create entries and issue certificates, revoke certificates</span></label>
                <label className="flex items-start gap-2"><input type="checkbox" name="scopes" value="pii" className="mt-1" /> <span><strong>pii</strong>: include people&apos;s mobile numbers and emails in responses</span></label></fieldset>
              <div><label className="label" htmlFor="exp">Expires</label><select id="exp" name="expiresInDays" className="input"><option value="0">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option></select></div>
            </RevealForm></div>)}
        <details className="card text-sm"><summary className="cursor-pointer font-semibold">Quick start</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs">{`curl ${env().APP_URL}/api/v1/campaigns -H "Authorization: Bearer $KUDOBIRD_KEY"

curl -X POST ${env().APP_URL}/api/v1/campaigns/CAMPAIGN_ID/entries \\
  -H "Authorization: Bearer $KUDOBIRD_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Asha Rao","mobile":"9876543210","consent":true}'`}</pre></details>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Webhooks</h2>
        {!hooksOn && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">Webhooks are not included in your plan.</p>}
        <p className="max-w-2xl text-sm text-neutral-600">We send a signed POST to your URL when something happens. Verify the <code>X-KudoBird-Signature</code> header (HMAC-SHA256 of <code>{"{t}.{body}"}</code> with your signing secret). Failed deliveries are retried for about a day.</p>
        {endpoints.map((e) => (
          <div key={e.id} className="card space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="break-all font-medium">{e.url}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${e.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{e.active ? "active" : "disabled"}</span>
              {e.includePii && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">includes contact details</span>}</div>
            <p className="text-xs text-neutral-500">{e.events.join(", ")}{e.description ? ` · ${e.description}` : ""}{e.consecutiveFailures > 0 ? ` · ${e.consecutiveFailures} failures in a row` : ""}</p>
            {e.disabledReason && <p className="rounded bg-red-50 p-2 text-xs text-red-800">{e.disabledReason}</p>}
            <div className="flex flex-wrap items-start gap-3">
              <ActionButton action={testWebhookAction} fields={{ id: e.id }} label="Send test" />
              <ActionButton action={toggleWebhookAction} fields={{ id: e.id, active: e.active ? "0" : "1" }} label={e.active ? "Disable" : "Enable"} />
              <ActionButton action={deleteWebhookAction} fields={{ id: e.id }} label="Delete" danger confirm="Delete this webhook and its delivery history?" />
            </div>
            <RevealForm action={rotateSecretAction} submit="Rotate signing secret" quiet confirm="Rotate the signing secret? The current one stops working immediately, so update your receiver right after." className="space-y-2"><input type="hidden" name="id" value={e.id} /></RevealForm>
            <details><summary className="cursor-pointer text-xs font-semibold">Recent deliveries</summary>
              <table className="mt-2 w-full text-left text-xs"><thead className="text-neutral-500"><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th>Result</th><th /></tr></thead>
                <tbody>{deliveries[e.id].map((d) => (
                  <tr key={d.id} className="border-t"><td className="py-1">{fmtTs(d.createdAt)}</td><td>{d.event}</td>
                    <td><span className={d.status === "SUCCESS" ? "text-green-700" : d.status === "PENDING" ? "text-neutral-600" : "text-red-700"}>{d.status.toLowerCase()}</span></td><td>{d.attempts}</td><td className="max-w-48 truncate">{d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : "")}</td>
                    <td><ActionButton action={redeliverAction} fields={{ id: d.id }} label="Resend" /></td></tr>))}
                  {deliveries[e.id].length === 0 && <tr><td colSpan={6} className="py-2 text-neutral-500">No deliveries yet.</td></tr>}</tbody></table></details>
          </div>))}
        {hooksOn && (
          <div className="card max-w-lg"><p className="mb-2 text-sm font-semibold">Add an endpoint</p>
            <RevealForm action={createWebhookAction} submit="Add webhook">
              <Field name="url" label="URL (https)" type="url" placeholder="https://example.org/hooks/kudobird" required />
              <Field name="description" label="Description (optional)" maxLength={120} />
              <fieldset className="space-y-1 text-sm"><legend className="label">Events</legend>{WEBHOOK_EVENTS.map((ev) => <label key={ev} className="flex items-center gap-2"><input type="checkbox" name="events" value={ev} defaultChecked={ev !== "certificate.revoked"} /> <code>{ev}</code></label>)}</fieldset>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="includePii" className="mt-1" /> <span>Include people&apos;s mobile numbers and emails in the payloads. Leave this off unless your receiver truly needs them.</span></label>
            </RevealForm></div>)}
      </section>
    </div>
  );
}
