import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the `@/*` alias from tsconfig so tests import the same way the app does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      // `lib/leads` pulls in @kesher/db, whose PrismaClient validates its
      // datasource at construction. Nothing under test issues a query, so a
      // syntactically valid URL is enough and no database is required.
      DATABASE_URL: "postgresql://unused:unused@localhost:1/unused",
    },
  },
});
