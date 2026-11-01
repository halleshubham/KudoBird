import { env } from "./env";

/** Every absolute link the product emits (emails, webhooks, API, QR codes) is built here, from APP_URL. */
export const appUrl = (path: string): string => new URL(path, env().APP_URL).toString();
export const certUrl = (publicId: string): string => appUrl(`/c/${publicId}`);
export const campaignFormUrl = (orgSlug: string, campaignSlug: string): string => appUrl(`/o/${orgSlug}/${campaignSlug}`);
