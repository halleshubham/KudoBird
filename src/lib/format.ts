/** Pure formatting helpers shared by server code, pages and tests. */

const DATE_LOCALES: Record<string, string> = { mr: "mr-IN", hi: "hi-IN", en: "en-IN" };

/**
 * The date printed on certificates and shown on their pages. Always India time: a certificate issued at 00:30 IST must not
 * show the previous day because the server runs in UTC. The designer preview uses this too, so it matches what is issued.
 */
export const formatCertDate = (d: Date, locale: string) => new Intl.DateTimeFormat(DATE_LOCALES[locale] ?? "en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(d);

/** UTC calendar day, `YYYY-MM-DD`, used to bucket time series. */
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** `2026-11-01 11:49` (UTC) for admin/audit tables. */
export const fmtTs = (d: Date | null | undefined, empty = "never") => (d ? d.toISOString().slice(0, 16).replace("T", " ") : empty);
