import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load the monorepo's root `.env` (searching upwards from the working directory).
 * Variables already set in the environment win, so deployments can override the file.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
