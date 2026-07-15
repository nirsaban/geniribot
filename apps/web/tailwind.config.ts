import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0d9488",
          dark: "#0f766e",
          light: "#14b8a6",
        },
        ink: "#0f172a",
        canvas: "#f6f8fa",
        line: "#e5e9ef",
        wa: "#25D366", // WhatsApp accent
      },
      fontFamily: {
        sans: ["var(--font-heebo)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.03)",
        card: "0 4px 20px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
