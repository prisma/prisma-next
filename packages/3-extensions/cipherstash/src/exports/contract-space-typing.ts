/**
 * Typed-narrowing helpers for the on-disk contract-space JSON artefacts
 * the cipherstash control descriptor wires into its
 * `SqlControlExtensionDescriptor`.
 *
 * JSON-imported values come back as widened, structurally-typed
 * objects: branded fields (`storageHash: StorageHashBase<string>`) and
 * discriminated unions (`MigrationPlanOperation['operationClass']`)
 * fall back to plain strings, so a direct assignment into the
 * descriptor surfaces is a type error. The cipherstash MVP previously
 * suppressed that error with `as unknown as X` triple-casts, which
 * silently masks any future shape drift between the emitted JSON and
 * the in-package descriptor.
 *
 * This module replaces the blind casts with thin runtime assertions
 * that fail fast on drift and narrow the JSON inputs to the framework
 * types in a single, auditable place. The assertions are intentionally
 * minimal — they check the canonical discriminator fields (`storageHash`,
 * `space`, `dirName`, `operationClass`, …) rather than re-validating
 * the whole emitter contract — which is enough to surface schema-level
 * drift while keeping the descriptor module light.
 */

import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

function fail(field: string, value: unknown): never {
  throw new Error(
    `cipherstash contract-space JSON is missing or malformed at "${field}" (saw ${typeof value}). The on-disk JSON drifted from the framework's expected shape — re-run \`prisma-next contract emit\` and \`prisma-next migration plan\` for the cipherstash space.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow a JSON-imported `contract.json` value to `Contract<SqlStorage>`.
 * Checks the discriminators the framework relies on at descriptor
 * registration time; everything else is consumed downstream by the
 * runner / verifier, which performs its own validation.
 */
export function asCipherstashContract(value: unknown): Contract<SqlStorage> {
  if (!isRecord(value)) fail('<root>', value);
  if (typeof value['target'] !== 'string') fail('target', value['target']);
  if (typeof value['targetFamily'] !== 'string') fail('targetFamily', value['targetFamily']);
  const storage = value['storage'];
  if (!isRecord(storage)) fail('storage', storage);
  if (typeof storage['storageHash'] !== 'string')
    fail('storage.storageHash', storage['storageHash']);
  return value as unknown as Contract<SqlStorage>;
}

/**
 * Narrow a JSON-imported `migration.json` value to `MigrationMetadata`.
 * The framework's runner consumes the metadata for ordering /
 * provenance; missing `to` or a non-string `migrationHash` here means
 * a non-emitted artefact slipped into the import path.
 */
export function asCipherstashMigrationMetadata(value: unknown): MigrationMetadata {
  if (!isRecord(value)) fail('<root>', value);
  if (typeof value['to'] !== 'string') fail('to', value['to']);
  if (typeof value['migrationHash'] !== 'string') fail('migrationHash', value['migrationHash']);
  return value as unknown as MigrationMetadata;
}

/**
 * Narrow a JSON-imported `ops.json` value to
 * `readonly MigrationPlanOperation[]`. Checks each entry carries the
 * canonical `id` / `operationClass` discriminator so a malformed entry
 * doesn't reach the planner.
 */
export function asCipherstashMigrationOps(value: unknown): readonly MigrationPlanOperation[] {
  if (!Array.isArray(value)) fail('<root>', value);
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) fail(`[${index}]`, entry);
    if (typeof entry['id'] !== 'string') fail(`[${index}].id`, entry['id']);
    if (typeof entry['operationClass'] !== 'string') {
      fail(`[${index}].operationClass`, entry['operationClass']);
    }
  }
  return value as unknown as readonly MigrationPlanOperation[];
}
