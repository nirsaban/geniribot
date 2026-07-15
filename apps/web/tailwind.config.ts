import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#128C7E", // WhatsApp-ish teal
          dark: "#075E54",
          light: "#25D366",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
