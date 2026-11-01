import { describe, expect, it } from "vitest";
import { maskEmail, maskMobile, normalizeMobile } from "@/server/campaigns/countries";
import { parseSettings, fieldsSchema, type FormField } from "@/server/campaigns/schema";
import { validateEntry } from "@/server/campaigns/validation";

const settings = parseSettings({});
const field = (o: Partial<FormField>): FormField => ({ key: "k", label: "L", translations: {}, type: "text", required: false, options: [], showOnCertificate: false, ...o });

describe("mobile validation (default India +91, 10 digits)", () => {
  it.each([["9876543210"], ["98765 43210"], ["+91 98765-43210"], ["09876543210"], ["919876543210"], ["0091 9876543210"]])("accepts %s", (raw) => {
    expect(normalizeMobile(raw, "IN")).toBe("+919876543210");
  });
  it.each([["1234567890"], ["987654321"], ["98765432101"], ["abcdefghij"], ["+44 9876543210"], [""]])("rejects %s", (raw) => {
    expect(normalizeMobile(raw, "IN")).toBeNull();
  });
  it("supports other countries", () => {
    expect(normalizeMobile("5551234567", "US")).toBe("+15551234567");
    expect(normalizeMobile("501234567", "AE")).toBe("+971501234567");
    expect(normalizeMobile("50123456", "AE")).toBeNull();
  });
  it("masks contact details", () => {
    expect(maskMobile("+919876543210")).toBe("+91••••••3210");
    expect(maskEmail("priya@example.com")).toBe("p•••@example.com");
  });
});

describe("entry validation", () => {
  const ok = { name: "  बळीराजा   पाटील ", mobile: "98765 43210", consent: "on" };
  it("accepts the minimal form and normalises values", () => {
    const r = validateEntry(ok, [], settings, "mr");
    expect(r).toMatchObject({ ok: true, value: { name: "बळीराजा पाटील", mobile: "+919876543210", email: null } });
  });
  it("requires name, mobile and consent, with messages in the chosen language", () => {
    const mr = validateEntry({}, [], settings, "mr");
    expect(mr.ok).toBe(false);
    if (!mr.ok) {
      expect(mr.errors.name).toBe("कृपया तुमचे पूर्ण नाव लिहा");
      expect(mr.errors.mobile).toContain("मोबाइल");
      expect(mr.errors.consent).toBeTruthy();
    }
    const hi = validateEntry({}, [], settings, "hi");
    if (!hi.ok) expect(hi.errors.mobile).toBe("सही मोबाइल नंबर दर्ज करें");
  });
  it("consent can be switched off", () => {
    expect(validateEntry({ name: "Aarav", mobile: "9876543210" }, [], { ...settings, consentRequired: false }, "en").ok).toBe(true);
  });
  it("rejects names with URLs or markup, bad email", () => {
    expect(validateEntry({ ...ok, name: "http://spam.example" }, [], settings, "en").ok).toBe(false);
    expect(validateEntry({ ...ok, name: "<script>" }, [], settings, "en").ok).toBe(false);
    expect(validateEntry({ ...ok, email: "nope" }, [], settings, "en").ok).toBe(false);
    expect(validateEntry({ ...ok, email: "A@B.com" }, [], settings, "en")).toMatchObject({ ok: true, value: { email: "a@b.com" } });
  });
  it("validates custom fields by type", () => {
    const fields = [
      field({ key: "village", required: true }),
      field({ key: "amount", type: "number", min: 1, max: 100 }),
      field({ key: "when", type: "date" }),
      field({ key: "kind", type: "select", options: ["A", "B"] }),
      field({ key: "zip", pattern: "^\\d{6}$" }),
    ];
    const base = { ...ok, village: "Nashik" };
    expect(validateEntry(base, fields, settings, "en").ok).toBe(true);
    const bad = validateEntry({ ...ok, amount: "500", when: "31/12/2026", kind: "Z", zip: "12" }, fields, settings, "en");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["amount", "kind", "village", "when", "zip"]);
    const good = validateEntry({ ...base, amount: "5", when: "2026-11-01", kind: "B", zip: "422001" }, fields, settings, "en");
    expect(good).toMatchObject({ ok: true, value: { custom: { village: "Nashik", amount: "5", when: "2026-11-01", kind: "B", zip: "422001" } } });
  });
  it("field definitions reject reserved/duplicate keys and empty selects", () => {
    expect(fieldsSchema.safeParse([field({ key: "name" })]).success).toBe(false);
    expect(fieldsSchema.safeParse([field({ key: "a" }), field({ key: "a" })]).success).toBe(false);
    expect(fieldsSchema.safeParse([field({ key: "a", type: "select" })]).success).toBe(false);
    expect(fieldsSchema.safeParse([field({ key: "a", pattern: "(" })]).success).toBe(false);
  });
});

describe("campaign settings", () => {
  it("accepts Devanagari hashtags (letters plus combining matras) and rejects junk", () => {
    expect(parseSettings({ hashtags: ["बळीराजाचीदिवाळी", "KudoBird", "दुष्काळग्रस्त"] }).hashtags).toHaveLength(3);
    expect(() => parseSettings({ hashtags: ["has space"] })).toThrow();
    expect(() => parseSettings({ hashtags: ["x!"] })).toThrow();
  });
});
