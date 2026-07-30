import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `@/*` alias from tsconfig so tests import the same way the app does.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server-only modules under test declare `import "server-only"`, which only
      // Next's bundler resolves. Point it at a no-op so they load in Vitest.
      "server-only": fileURLToPath(new URL("./vitest/server-only.stub.ts", import.meta.url)),
    },
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
