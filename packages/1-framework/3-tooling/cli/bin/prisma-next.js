#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entrypoint = resolve(__dirname, '../dist/cli.js');

if (!existsSync(entrypoint)) {
  // eslint-disable-next-line no-console
  console.error(
    '[prisma-next] CLI is not built. Run `pnpm -C packages/1-framework/3-tooling/cli build` (or `pnpm build`).',
  );
  process.exit(1);
}

await import(pathToFileURL(entrypoint).href);
