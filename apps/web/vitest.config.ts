import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" shortcut as tsconfig.json, so components import like they do in the app.
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    // Pure logic runs in Node; component tests opt in with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30000,
  },
  // Vite compiles JSX with the automatic runtime so test files need no React import.
  oxc: { jsx: { runtime: "automatic" } },
});
