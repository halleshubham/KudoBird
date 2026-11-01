const PLACEHOLDER = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

/**
 * Replaces {{key}} with values from `data` (name, campaign, date, certificate_no, org and any custom field key).
 * Unknown keys become an empty string so a typo never leaks the raw braces onto a certificate.
 * Output is plain text; callers must HTML-escape it.
 */
export function replacePlaceholders(text: string, data: Record<string, string | undefined | null>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => data[key] ?? "");
}

/** Placeholder keys used in a text, for validating templates against a campaign's fields. */
export function extractPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

export const SYSTEM_PLACEHOLDERS = ["name", "campaign", "org", "date", "certificate_no"] as const;
