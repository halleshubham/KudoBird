import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { 50: "#eff6ff", 100: "#dbeafe", 500: "#2f7df6", 600: "#0b6cf0", 700: "#0956c4" }, canvas: "#fafafa" },
      fontFamily: { sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
