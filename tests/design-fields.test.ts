import { describe, expect, it } from "vitest";
import { BLOCK_KEYS, designSchema, type Design } from "../src/server/render/design";
import { renderCertificateHtml } from "../src/server/render/html";
import { presetDesign } from "../src/server/render/presets";

const ID = "11111111-1111-4111-8111-111111111111";
const base = (): Design => {
  const d = presetDesign("festive", "en");
  d.border.style = "solid"; d.border.width = 1; d.background.assetId = ID; d.logos.assetIds = [ID]; d.qr.show = true; d.signatories.show = true;
  return d;
};
const render = (d: Design) =>
  renderCertificateHtml({ design: d, data: { name: "Aarav", campaign: "C", org: "O", date: "1 Nov", certificate_no: "X-1", city: "Pune" }, assets: { [ID]: "data:image/png;base64,AA" },
    signatories: [{ name: "Dr. Rao", designation: "Chair" }], qrSrc: "data:image/png;base64,BB", size: { w: 1080, h: 1080 }, fontCss: "" });

/** Every editable design field must change what is rendered, otherwise the designer shows a control that does nothing. */
describe("every design field affects the rendered certificate", () => {
  const cases: [string, (d: Design) => void][] = [
    ["background.color", (d) => { d.background.color = "#123456"; }],
    ["background.gradientTo", (d) => { d.background.gradientTo = "#654321"; }],
    ["background.fit", (d) => { d.background.fit = "contain"; }],
    ["background.overlay", (d) => { d.background.overlay = 0.5; }],
    ["background.assetId", (d) => { d.background.assetId = null; }],
    ["border.style", (d) => { d.border.style = "double"; }],
    ["border.color", (d) => { d.border.color = "#0a0b0c"; }],
    ["border.width", (d) => { d.border.width = 3; }],
    ["border.inset", (d) => { d.border.inset = 5; }],
    ["logos.assetIds", (d) => { d.logos.assetIds = []; }],
    ["logos.position", (d) => { d.logos.position = d.logos.position === "top-left" ? "top-right" : "top-left"; }],
    ["logos.height", (d) => { d.logos.height += 3; }],
    ["signatories.show", (d) => { d.signatories.show = false; }],
    ["signatories.font", (d) => { d.signatories.font = "Lora"; }],
    ["signatories.color", (d) => { d.signatories.color = "#0a0b0c"; }],
    ["signatories.size", (d) => { d.signatories.size += 1; }],
    ["qr.show", (d) => { d.qr.show = false; }],
    ["qr.position", (d) => { d.qr.position = d.qr.position === "bottom-left" ? "bottom-right" : "bottom-left"; }],
    ["qr.size", (d) => { d.qr.size += 2; }],
    ...BLOCK_KEYS.flatMap((k): [string, (d: Design) => void][] => [
      [`${k}.show`, (d) => { d.blocks[k].show = !d.blocks[k].show; }],
      [`${k}.text`, (d) => { d.blocks[k].text = "Changed {{city}}"; }],
      [`${k}.font`, (d) => { d.blocks[k].font = "Lora"; }],
      [`${k}.size`, (d) => { d.blocks[k].size += 1; }],
      [`${k}.weight`, (d) => { d.blocks[k].weight = d.blocks[k].weight === 700 ? 400 : 700; }],
      [`${k}.align`, (d) => { d.blocks[k].align = d.blocks[k].align === "left" ? "right" : "left"; }],
      [`${k}.color`, (d) => { d.blocks[k].color = "#0a0b0c"; }],
      [`${k}.italic`, (d) => { d.blocks[k].italic = !d.blocks[k].italic; }],
    ]),
  ];

  it.each(cases)("%s", (_name, mutate) => {
    const before = render(base());
    const d = base();
    mutate(d);
    expect(designSchema.safeParse(d).success).toBe(true);
    expect(render(d)).not.toBe(before);
  });

  it("custom-field placeholders are filled from the data", () => {
    const d = base();
    d.blocks.body.text = "From {{city}}";
    expect(render(d)).toContain("From Pune");
  });

  it("designs saved before background fit/overlay existed still parse and render the same as the defaults", () => {
    const old = JSON.parse(JSON.stringify(base()));
    delete old.background.fit; delete old.background.overlay;
    const parsed = designSchema.parse(old);
    expect(parsed.background.fit).toBe("cover");
    expect(parsed.background.overlay).toBe(0);
    expect(render(parsed)).toBe(render(base()));
  });
});
