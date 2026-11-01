import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #aabbcc");

export const blockSchema = z.object({
  show: z.boolean().default(true),
  text: z.string().max(600),
  font: z.string().min(1).max(80),
  /** Size in units of 1/100 of the canvas' shorter side, so layouts scale to every output size. */
  size: z.number().min(1).max(30),
  weight: z.number().int().min(100).max(900).default(400),
  align: z.enum(["left", "center", "right"]).default("center"),
  color,
  italic: z.boolean().default(false),
});
export type Block = z.infer<typeof blockSchema>;

export const BLOCK_KEYS = ["title", "subtitle", "recipient", "body", "footer"] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

export const designSchema = z.object({
  version: z.literal(1).default(1),
  preset: z.string(),
  background: z.object({
    color,
    gradientTo: color.nullable().default(null),
    assetId: z.string().uuid().nullable().default(null),
    /** How the background image fills the page. */
    fit: z.enum(["cover", "contain"]).default("cover"),
    /** 0-0.9: how strongly the background colour is laid over the image, to keep text readable. */
    overlay: z.number().min(0).max(0.9).default(0),
  }),
  border: z.object({
    style: z.enum(["none", "solid", "double", "ornate"]),
    color,
    width: z.number().min(0).max(5),
    inset: z.number().min(0).max(12),
  }),
  logos: z.object({
    assetIds: z.array(z.string().uuid()).max(3).default([]),
    position: z.enum(["top-left", "top-center", "top-right"]).default("top-center"),
    height: z.number().min(3).max(25).default(10),
  }),
  blocks: z.object({ title: blockSchema, subtitle: blockSchema, recipient: blockSchema, body: blockSchema, footer: blockSchema }),
  signatories: z.object({ show: z.boolean().default(true), font: z.string(), color, size: z.number().min(1).max(8).default(2.4) }),
  qr: z.object({ show: z.boolean().default(true), position: z.enum(["bottom-left", "bottom-right"]).default("bottom-right"), size: z.number().min(6).max(20).default(10) }),
});
export type Design = z.infer<typeof designSchema>;

/** Every font family referenced by the design (to cache/embed). */
export function designFonts(d: Design): string[] {
  return [...new Set([...Object.values(d.blocks).map((b) => b.font), d.signatories.font])];
}
