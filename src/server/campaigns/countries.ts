/** Mobile number rules per country. India is the default; orgs can pick another per campaign. */
export interface Country { code: string; name: string; dial: string; minDigits: number; maxDigits: number; pattern?: RegExp }

export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", dial: "+91", minDigits: 10, maxDigits: 10, pattern: /^[6-9]\d{9}$/ },
  { code: "NP", name: "Nepal", dial: "+977", minDigits: 10, maxDigits: 10 },
  { code: "BD", name: "Bangladesh", dial: "+880", minDigits: 10, maxDigits: 10 },
  { code: "LK", name: "Sri Lanka", dial: "+94", minDigits: 9, maxDigits: 9 },
  { code: "PK", name: "Pakistan", dial: "+92", minDigits: 10, maxDigits: 10 },
  { code: "AE", name: "United Arab Emirates", dial: "+971", minDigits: 9, maxDigits: 9 },
  { code: "SG", name: "Singapore", dial: "+65", minDigits: 8, maxDigits: 8 },
  { code: "GB", name: "United Kingdom", dial: "+44", minDigits: 10, maxDigits: 10 },
  { code: "US", name: "United States / Canada", dial: "+1", minDigits: 10, maxDigits: 10 },
  { code: "AU", name: "Australia", dial: "+61", minDigits: 9, maxDigits: 9 },
];

export const getCountry = (code: string) => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];

/** Returns E.164 (e.g. +919876543210) or null when invalid for the country. */
export function normalizeMobile(raw: string, countryCode: string): string | null {
  const c = getCountry(countryCode);
  let digits = raw.replace(/[\s\-().]/g, "");
  const dialDigits = c.dial.slice(1);
  if (digits.startsWith("+")) {
    if (!digits.startsWith(c.dial)) return null;
    digits = digits.slice(c.dial.length);
  } else if (digits.startsWith("00" + dialDigits)) {
    digits = digits.slice(2 + dialDigits.length);
  } else if (digits.length === c.maxDigits + dialDigits.length && digits.startsWith(dialDigits)) {
    digits = digits.slice(dialDigits.length);
  } else if (digits.startsWith("0") && digits.length === c.maxDigits + 1) {
    digits = digits.slice(1);
  }
  if (!/^\d+$/.test(digits) || digits.length < c.minDigits || digits.length > c.maxDigits) return null;
  if (c.pattern && !c.pattern.test(digits)) return null;
  return c.dial + digits;
}

/** 98******10 style mask for lists. Full numbers are shown only on explicit reveal. */
export function maskMobile(e164: string): string {
  if (e164.length < 6) return "••••";
  return e164.slice(0, 3) + "•".repeat(Math.max(e164.length - 7, 2)) + e164.slice(-4);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "••••";
  return `${local.slice(0, 1)}•••@${domain}`;
}
