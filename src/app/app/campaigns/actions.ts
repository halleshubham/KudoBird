"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionState, type ActionState } from "@/app/_lib/action-errors";
import { z } from "zod";

import {
  createCampaign, createSignatory, deleteSignatory, getCampaign, reviewEntry, revealEntryContact, saveTemplateDesign,
  setCampaignSignatories, updateCampaign,
} from "@/server/campaigns/service";
import { LOCALES, fieldsSchema, settingsSchema } from "@/server/campaigns/schema";
import { PRESETS } from "@/server/render/presets";
import { regenerateCertificate, restoreCertificate, revokeCertificate } from "@/server/certificates/issue";
import { resendCertificateEmail } from "@/server/email/resend";
import { requireOrg } from "@/server/session";

type State = ActionState;
const fail = toActionState;

export async function createCampaignAction(_: State, fd: FormData): Promise<State> {
  let id: string;
  try {
    const { ctx } = await requireOrg("campaigns.manage");
    const v = z.object({ name: z.string().trim().min(2).max(100), locale: z.enum(LOCALES), preset: z.enum(PRESETS), numberPrefix: z.string().max(8).optional() }).parse(Object.fromEntries(fd));
    id = (await createCampaign(ctx, v)).id;
  } catch (e) { return fail(e); }
  redirect(`/app/campaigns/${id}`);
}

export async function updateCampaignAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("campaigns.manage");
    const v = z.object({
      id: z.string().uuid(), name: z.string().trim().min(2).max(100), description: z.string().max(500).optional(),
      status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]), locale: z.enum(LOCALES), numberPrefix: z.string().min(1).max(8),
    }).parse(Object.fromEntries(fd));
    const { id, ...patch } = v;
    await updateCampaign(ctx, id, patch);
    revalidatePath(`/app/campaigns/${id}`);
    return { info: "Saved" };
  } catch (e) { return fail(e); }
}

const bool = (fd: FormData, k: string) => fd.get(k) === "on";

export async function updateSettingsAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("campaigns.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const current = (await getCampaign(ctx, id)).settings;
    const settings = settingsSchema.parse({
      ...current,
      languages: LOCALES.filter((l) => bool(fd, `lang_${l}`)),
      mobileCountry: String(fd.get("mobileCountry")),
      duplicateMode: String(fd.get("duplicateMode")),
      approvalMode: bool(fd, "approvalMode"),
      captcha: bool(fd, "captcha"),
      otpEnabled: bool(fd, "otpEnabled"),
      consentRequired: bool(fd, "consentRequired"),
      wallEnabled: bool(fd, "wallEnabled"),
      consentText: { en: String(fd.get("consent_en") ?? "") || undefined, hi: String(fd.get("consent_hi") ?? "") || undefined, mr: String(fd.get("consent_mr") ?? "") || undefined },
      email: {
        certificateSubject: Object.fromEntries(LOCALES.map((l) => [l, String(fd.get(`certSubject_${l}`) ?? "") || undefined])),
        certificateIntro: Object.fromEntries(LOCALES.map((l) => [l, String(fd.get(`certIntro_${l}`) ?? "") || undefined])),
        rejectedSubject: current.email.rejectedSubject,
        rejectedIntro: Object.fromEntries(LOCALES.map((l) => [l, String(fd.get(`rejIntro_${l}`) ?? "") || undefined])),
      },
      embedOrigins: String(fd.get("embedOrigins") ?? "").split(/[\s,]+/).filter(Boolean),
      retentionDays: Number(fd.get("retentionDays")) > 0 ? Number(fd.get("retentionDays")) : null,
      shareText: String(fd.get("shareText") ?? current.shareText),
      hashtags: String(fd.get("hashtags") ?? "").split(/[\s,#]+/).filter(Boolean),
    });
    await updateCampaign(ctx, id, { settings });
    revalidatePath(`/app/campaigns/${id}`);
    return { info: "Saved" };
  } catch (e) { return fail(e); }
}

/** Form fields arrive as one JSON string built by the client-side editor, then validated server-side. */
export async function updateFieldsAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("campaigns.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const fields = fieldsSchema.parse(JSON.parse(String(fd.get("fields") ?? "[]")));
    await updateCampaign(ctx, id, { formFields: fields });
    revalidatePath(`/app/campaigns/${id}/form`);
    return { info: "Saved" };
  } catch (e) { return fail(e); }
}

export async function saveDesignAction(campaignId: string, templateId: string, design: unknown, signatoryIds: string[]): Promise<{ error?: string; info?: string; version?: number }> {
  try {
    const { ctx } = await requireOrg("templates.manage");
    const { version } = await saveTemplateDesign(ctx, templateId, design);
    await setCampaignSignatories(ctx, campaignId, signatoryIds);
    revalidatePath(`/app/campaigns/${campaignId}/design`);
    return { info: `Saved as version ${version}`, version };
  } catch (e) { return fail(e) ?? { error: "Something went wrong" }; }
}

export async function createSignatoryAction(_: State, fd: FormData): Promise<State> {
  try {
    const { ctx } = await requireOrg("signatories.manage");
    const v = z.object({ name: z.string().trim().min(2).max(80), designation: z.string().trim().min(2).max(100), assetId: z.string().uuid().optional().or(z.literal("")) }).parse(Object.fromEntries(fd));
    await createSignatory(ctx, { ...v, assetId: v.assetId || null });
    revalidatePath("/app/signatories");
    return { info: "Signatory added" };
  } catch (e) { return fail(e); }
}

export async function deleteSignatoryAction(fd: FormData) {
  const { ctx } = await requireOrg("signatories.manage");
  await deleteSignatory(ctx, String(fd.get("id")));
  revalidatePath("/app/signatories");
}

export async function reviewEntryAction(fd: FormData) {
  const { ctx } = await requireOrg("entries.manage");
  const campaignId = String(fd.get("campaignId"));
  await reviewEntry(ctx, String(fd.get("entryId")), fd.get("decision") === "APPROVED" ? "APPROVED" : "REJECTED");
  revalidatePath(`/app/campaigns/${campaignId}/entries`);
}

export async function revealContactAction(entryId: string) {
  const { ctx } = await requireOrg("entries.view");
  return revealEntryContact(ctx, entryId);
}

export async function certificateAction(fd: FormData) {
  const { ctx } = await requireOrg("entries.manage");
  const id = String(fd.get("certificateId"));
  const op = String(fd.get("op"));
  if (op === "regenerate") await regenerateCertificate(ctx, id, fd.get("latest") === "1");
  else if (op === "revoke") await revokeCertificate(ctx, id, String(fd.get("reason") ?? "") || undefined);
  else if (op === "restore") await restoreCertificate(ctx, id);
  revalidatePath(`/app/campaigns/${String(fd.get("campaignId"))}/entries`);
}

export async function resendEmailAction(fd: FormData) {
  const { ctx } = await requireOrg("entries.manage");
  await resendCertificateEmail(ctx, String(fd.get("certificateId")));
  revalidatePath(`/app/campaigns/${String(fd.get("campaignId"))}/entries`);
}
