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
import type { OperationDescriptor } from '@prisma-next/core-control-plane/types';
import { join, resolve } from 'pathe';

const MIGRATION_TS_FILE = 'migration.ts';

/**
 * Options for scaffolding a migration.ts file.
 */
export interface ScaffoldOptions {
  /** Operation descriptors to serialize as builder calls. */
  readonly descriptors?: readonly OperationDescriptor[];
}

function serializeQueryNode(node: unknown): string {
  if (typeof node === 'boolean') return String(node);
  if (node === null || node === undefined) return 'null';
  return JSON.stringify(node);
}

function descriptorToBuilderCall(desc: OperationDescriptor): string {
  switch (desc.kind) {
    case 'createTable':
      return `createTable(${JSON.stringify(desc['table'])})`;
    case 'dropTable':
      return `dropTable(${JSON.stringify(desc['table'])})`;
    case 'addColumn': {
      const args = [JSON.stringify(desc['table']), JSON.stringify(desc['column'])];
      if (desc['overrides']) {
        args.push(JSON.stringify(desc['overrides']));
      }
      return `addColumn(${args.join(', ')})`;
    }
    case 'dropColumn':
      return `dropColumn(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'alterColumnType':
      return `alterColumnType(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'setNotNull':
      return `setNotNull(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'dropNotNull':
      return `dropNotNull(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'setDefault':
      return `setDefault(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'dropDefault':
      return `dropDefault(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'addPrimaryKey':
      return `addPrimaryKey(${JSON.stringify(desc['table'])})`;
    case 'addUnique':
      return `addUnique(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'addForeignKey':
      return `addForeignKey(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'dropConstraint':
      return `dropConstraint(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['constraintName'])})`;
    case 'createIndex':
      return `createIndex(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'dropIndex':
      return `dropIndex(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['indexName'])})`;
    case 'createEnumType':
      return `createEnumType(${JSON.stringify(desc['typeName'])})`;
    case 'createDependency':
      return `createDependency(${JSON.stringify(desc['dependencyId'])})`;
    case 'dataTransform':
      return `dataTransform(${JSON.stringify(desc['name'])}, {\n    check: ${serializeQueryNode(desc['check'])},\n    run: ${serializeQueryNode(desc['run'])},\n  })`;
    default:
      throw new Error(`Unknown descriptor kind: ${desc.kind}`);
  }
}

/**
 * Scaffolds a migration.ts file in the given package directory.
 * Serializes operation descriptors as builder calls that the user can edit.
 * On verify, this file is re-evaluated to produce the final ops.
 */
export async function scaffoldMigrationTs(
  packageDir: string,
  options: ScaffoldOptions = {},
): Promise<void> {
  const filePath = join(packageDir, MIGRATION_TS_FILE);

  const descriptors = options.descriptors ?? [];

  const importList = [...new Set(descriptors.map((d) => d.kind))];
  if (importList.length === 0) {
    importList.push('createTable');
  }
  const importLine = `import { ${importList.join(', ')} } from "@prisma-next/target-postgres/migration-builders"`;

  const calls = descriptors.map((d) => `  ${descriptorToBuilderCall(d)},`).join('\n');
  const body = calls.length > 0 ? `\n${calls}\n` : '';

  const content = `${importLine}\n\nexport default () => [${body}]\n`;

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
  const filePath = resolve(join(packageDir, MIGRATION_TS_FILE));

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
