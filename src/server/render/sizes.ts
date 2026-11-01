export const OUTPUT_SIZES = {
  square: { w: 1080, h: 1080, label: "Square 1080×1080 (Instagram / WhatsApp)" },
  story: { w: 1080, h: 1920, label: "Story 1080×1920 (Stories / Status)" },
  link: { w: 1200, h: 630, label: "Link preview 1200×630 (Facebook / X / LinkedIn)" },
  a4: { w: 1754, h: 1240, label: "A4 landscape (print)" },
} as const;
export type OutputSize = keyof typeof OUTPUT_SIZES;
