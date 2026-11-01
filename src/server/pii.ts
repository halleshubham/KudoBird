import { decrypt } from "./crypto";

/**
 * The ONLY place that turns an entry's stored contact details back into readable text.
 * Everything else (lists, exports, API, webhooks, emails) goes through these helpers, so "who can see a phone number" is a
 * question answered by searching for this module's imports. tests/structure.test.ts enforces that.
 */
interface StoredContact { mobileEnc: string; emailEnc: string | null }

export const revealContact = (e: StoredContact): { mobile: string; email: string | null } => ({ mobile: decrypt(e.mobileEnc), email: e.emailEnc ? decrypt(e.emailEnc) : null });
export const revealMobile = (e: Pick<StoredContact, "mobileEnc">): string => decrypt(e.mobileEnc);
export const revealEmail = (e: Pick<StoredContact, "emailEnc">): string | null => (e.emailEnc ? decrypt(e.emailEnc) : null);
