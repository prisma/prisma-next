/**
 * Utilities for scaffolding and evaluating migration.ts files.
 *
 * - scaffoldMigrationTs: writes a migration.ts file with boilerplate
 * - evaluateMigrationTs: loads migration.ts via native Node import, returns descriptors
 *
 * Shared by migration plan (scaffold), migration new (scaffold), and
 * migration verify (evaluate).
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'pathe';

const MIGRATION_TS_FILE = 'migration.ts';

/**
 * Options for scaffolding a migration.ts file.
 */
export interface ScaffoldOptions {
  /** Detected changes that need data migration, used to generate comments. */
  readonly detectedChanges?: readonly string[];
  /** Whether to include a dataTransform placeholder. */
  readonly includeDataTransform?: boolean;
  /** Name for the data transform (used as invariant identity). */
  readonly dataTransformName?: string;
}

/**
 * Scaffolds a migration.ts file in the given package directory.
 * The file contains operation builder imports and a default export
 * returning an operation list. If data migration is detected, includes
 * an unimplemented dataTransform that prevents attestation.
 */
export async function scaffoldMigrationTs(
  packageDir: string,
  options: ScaffoldOptions = {},
): Promise<void> {
  const filePath = join(packageDir, MIGRATION_TS_FILE);

  const changeComments = options.detectedChanges?.length
    ? options.detectedChanges.map((c) => `//   - ${c}`).join('\n')
    : '';

  const dataTransformBlock =
    options.includeDataTransform && options.dataTransformName
      ? `
  // Data transform: ${options.dataTransformName}
  // The following changes were detected that require a data migration:
${changeComments}
  //
  // Fill in the check and run functions using the query builder.
  // check: return a query describing violations (empty result = already applied)
  // run: return the query (or queries) to transform the data
  dataTransform("${options.dataTransformName}", {
    check: false, // TODO: implement check
    run: { kind: "todo" }, // TODO: implement run
  }),`
      : '';

  const content = `import { addColumn, dropColumn, setNotNull, dropNotNull, setDefault, dropDefault, alterColumnType, createTable, dropTable, addPrimaryKey, addUnique, addForeignKey, dropConstraint, createIndex, dropIndex, createType, dataTransform } from "@prisma-next/target-postgres/migration-builders"

export default () => [${dataTransformBlock}
]
`;

  await writeFile(filePath, content);
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
 * Evaluates a migration.ts file by loading it via native Node import.
 * Returns the result of calling the default export (expected to be a
 * function returning an array of operation descriptors).
 *
 * Requires Node ≥24 for native TypeScript support.
 */
export async function evaluateMigrationTs(packageDir: string): Promise<readonly unknown[]> {
  const filePath = join(packageDir, MIGRATION_TS_FILE);

  // Verify the file exists before attempting import
  try {
    // TODO: readFile to verify?
    await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`migration.ts not found at "${filePath}"`);
  }

  // Use native Node TS import (Node ≥24, stable type stripping)
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
  // TODO: Maybe we should consider using arktype schemas for validation here, otherwise we can't really safely cast the result?

  return result;
}
