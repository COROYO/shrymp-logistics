import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "functions/**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "lib/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws on import to enforce no-client-bundle usage;
      // in a Node test runner that guard is unnecessary, so stub it out.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
