import { describe, expect, it } from "vitest";
import { extractPlaceholders, replacePlaceholders } from "@/server/render/placeholders";
import { esc, renderCertificateHtml } from "@/server/render/html";
import { presetDesign, PRESETS } from "@/server/render/presets";
import { designSchema } from "@/server/render/design";

describe("placeholder replacement", () => {
  const data = { name: "बळीराजा", campaign: "दिवाळी", certificate_no: "SJA-2026-00042", village: "Nashik" };
  it("replaces system and custom keys, tolerating whitespace", () => {
    expect(replacePlaceholders("{{name}} / {{ campaign }} / {{certificate_no}} / {{village}}", data)).toBe("बळीराजा / दिवाळी / SJA-2026-00042 / Nashik");
  });
  it("replaces repeated keys and leaves unknown keys empty (never raw braces)", () => {
    expect(replacePlaceholders("{{name}} {{name}} [{{missing}}]", data)).toBe("बळीराजा बळीराजा []");
  });
  it("does not interpret non-identifier braces", () => {
    expect(replacePlaceholders("{{ 1+1 }} {name} {{}}", data)).toBe("{{ 1+1 }} {name} {{}}");
  });
  it("extracts keys", () => {
    expect(extractPlaceholders("{{name}} {{ village }} {{name}}")).toEqual(["name", "village"]);
  });
});

describe("certificate html", () => {
  const base = { assets: {}, signatories: [{ name: "A <b>B</b>", designation: "Chair" }], size: { w: 1080, h: 1080 }, fontCss: "" };
  it("escapes user-controlled values so a name cannot inject markup", () => {
    const html = renderCertificateHtml({ ...base, design: presetDesign("classic", "en"), data: { name: `<img src=x onerror=alert(1)>`, campaign: "C", org: "O", date: "d", certificate_no: "X-1" } });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("A &lt;b&gt;B&lt;/b&gt;");
    expect(esc(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });
  it("every preset is a valid design in every locale and renders the placeholders", () => {
    for (const p of PRESETS) for (const l of ["en", "hi", "mr"] as const) {
      const d = presetDesign(p, l);
      expect(() => designSchema.parse(d)).not.toThrow();
      const html = renderCertificateHtml({ ...base, design: d, data: { name: "नमुना", campaign: "मोहीम", org: "संस्था", date: "१ नोव्हेंबर" } });
      expect(html).toContain("नमुना");
      expect(html).not.toContain("{{");
    }
  });
  it("Devanagari presets default to a Devanagari font", () => {
    expect(presetDesign("classic", "mr").blocks.recipient.font).toBe("Noto Serif Devanagari");
  });
});
