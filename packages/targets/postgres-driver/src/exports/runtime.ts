import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { type } from 'arktype';
import type { PostgresDriverOptions } from '../postgres-driver';
import { createPostgresDriverFromOptions } from '../postgres-driver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const ExtensionPackManifestSchema = type({
  id: 'string',
  version: 'string',
  'targets?': type({ '[string]': type({ 'minVersion?': 'string' }) }),
  'capabilities?': 'Record<string, unknown>',
  'types?': type({
    'codecTypes?': type({
      import: TypesImportSpecSchema,
    }),
    'operationTypes?': type({
      import: TypesImportSpecSchema,
    }),
  }),
  'operations?': 'unknown[]',
});

/**
 * Loads the driver manifest from packs/manifest.json.
 */
function loadDriverManifest(): ExtensionPackManifest {
  const manifestPath = join(__dirname, '../../packs/manifest.json');
  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid driver manifest structure at ${manifestPath}: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

/**
 * Postgres runtime driver instance interface.
 * SqlDriver provides SQL-specific methods (execute, explain, close).
 * RuntimeDriverInstance provides target identification (targetId).
 * We use intersection type to combine both interfaces.
 */
export type PostgresRuntimeDriver = RuntimeDriverInstance<'postgres'> & SqlDriver;

/**
 * Postgres driver descriptor for runtime plane.
 */
const postgresRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PostgresRuntimeDriver
> = {
  kind: 'driver',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest: loadDriverManifest(),
  create(options: PostgresDriverOptions): PostgresRuntimeDriver {
    return createPostgresDriverFromOptions(options) as PostgresRuntimeDriver;
  },
};

export default postgresRuntimeDriverDescriptor;
export type {
  CreatePostgresDriverOptions,
  PostgresDriverOptions,
  QueryResult,
} from '../postgres-driver';
export { createPostgresDriver, createPostgresDriverFromOptions } from '../postgres-driver';
