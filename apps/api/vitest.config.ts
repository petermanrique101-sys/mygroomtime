import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(here, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // why: API tests share a Postgres + signup global state. Running files in parallel
    // races on tenant slug timestamps and webhook-event prefixes. Suite is fast (~17s)
    // so serial execution is the right trade-off.
    fileParallelism: false,
  },
});
