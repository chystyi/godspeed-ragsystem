import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Many specs start a real NestJS application, which takes seconds on a busy machine
    // (all live specs run in parallel); the 5 second default made them flaky.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
