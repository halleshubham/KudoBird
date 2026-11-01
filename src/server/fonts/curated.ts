/** Shown first in font pickers; the rest of the Google Fonts catalogue is reachable via search. */
export const BUNDLED_FONTS = ["Noto Serif Devanagari", "Noto Sans Devanagari", "Mukta", "Tiro Devanagari Marathi"] as const;
export const DEFAULT_DEVANAGARI_FONT = "Noto Serif Devanagari";
export const DEFAULT_LATIN_FONT = "Playfair Display";

export const CURATED_FONTS = [
  ...BUNDLED_FONTS,
  "Hind", "Laila", "Yatra One", "Baloo 2", "Kalam",
  "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather", "EB Garamond", "Cinzel",
  "Montserrat", "Poppins", "Open Sans", "Roboto", "Lato", "Inter", "Raleway",
  "Great Vibes", "Dancing Script", "Pacifico",
];

/** Weights bundled/cached by default for each font used by a template. */
export const DEFAULT_WEIGHTS = [400, 700];
