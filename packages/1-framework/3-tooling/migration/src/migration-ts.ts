/**
 * Utilities for reading/writing `migration.ts` files.
 *
 * Rendering migration.ts source is now the target's responsibility — the CLI
 * obtains source strings either from a class-flow planner's
 * `plan.renderTypeScript()` or from a descriptor-flow target's
 * `migrations.renderDescriptorTypeScript(descriptors, context)`. The helper
 * here is limited to file I/O: writing the returned source with the right
 * executable bit, probing for existence, and evaluating legacy descriptor-
 * flow files.
 */

import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'pathe';

const MIGRATION_TS_FILE = 'migration.ts';

/**
 * Writes a pre-rendered `migration.ts` source string to the given package
 * directory. If the source begins with a shebang, the file is written with
 * executable permissions (0o755) so it can be run directly via
 * `./migration.ts` by the authoring class's `Migration.run(...)` guard.
 */
export async function writeMigrationTs(packageDir: string, content: string): Promise<void> {
  const isExecutable = content.startsWith('#!');
  await writeFile(
    join(packageDir, MIGRATION_TS_FILE),
    content,
    isExecutable ? { mode: 0o755 } : undefined,
  );
}

/**
 * Checks whether a migration.ts file exists in the package directory.
 */
export async function hasMigrationTs(packageDir: string): Promise<boolean> {
  try {
    const s = await stat(join(packageDir, MIGRATION_TS_FILE));
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Evaluates a descriptor-flow migration.ts file by loading it via native
 * Node import. Returns the result of calling the default export (expected
 * to be a function returning an array of operation descriptors).
 *
 * Class-flow migration.ts files use a different shape — their default
 * export is a class that extends `Migration` — and are evaluated by the
 * target's `emit` capability, not this helper.
 *
 * Requires Node ≥24 for native TypeScript support.
 */
export async function evaluateMigrationTs(packageDir: string): Promise<readonly unknown[]> {
  const filePath = resolve(join(packageDir, MIGRATION_TS_FILE));

  try {
    await stat(filePath);
  } catch {
    throw new Error(`migration.ts not found at "${filePath}"`);
  }

  const mod = (await import(filePath)) as { default?: unknown };

  if (typeof mod.default !== 'function') {
    throw new Error(
      `migration.ts must export a default function returning an operation list. Got: ${typeof mod.default}`,
    );
  }

  const result: unknown = mod.default();

  if (!Array.isArray(result)) {
    throw new Error(
      `migration.ts default export must return an array of operations. Got: ${typeof result}`,
    );
  }

  return result;
}
