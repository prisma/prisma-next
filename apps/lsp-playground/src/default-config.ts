import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Generates a default-postgres `prisma-next.config.ts` whose contract source is
 * the given absolute `.psl` path, and returns the generated config's absolute
 * path. Used when the user did not point the playground at an existing config:
 * "without the config, assume default postgres configuration."
 *
 * The config is written under the playground package's own `.playground/`
 * directory (NOT the OS temp dir) so that the `@prisma-next/*` imports resolve
 * through the workspace `node_modules` when `c12` loads it.
 *
 * The config mirrors the canonical postgres + PSL recipe used across the repo's
 * fixtures. The language server only ever reads `contract.source.inputs` (it
 * never invokes `load`), so the full postgres pipeline is wired for fidelity but
 * is not exercised for diagnostics.
 *
 * `prismaContract` resolves `inputs` relative to the config dir; passing the
 * absolute schema path keeps the resolved input exactly equal to the file URI
 * the browser editor opens, which is what the server matches against.
 */
export async function generateDefaultPostgresConfig(absoluteSchemaPath: string): Promise<string> {
  const dir = join(packageRoot, '.playground');
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, 'prisma-next.config.ts');
  const json = JSON.stringify(absoluteSchemaPath);
  const contents = `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: prismaContract(${json}, {
    output: 'output/contract.json',
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
});
`;
  await writeFile(configPath, contents, 'utf8');
  return configPath;
}
