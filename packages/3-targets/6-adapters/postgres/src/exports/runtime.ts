import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionPackManifest } from '@prisma-next/contract/pack-manifest-types';
import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';
import type { Adapter, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { type } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const StorageTypeMetadataSchema = type({
  typeId: 'string',
  familyId: 'string',
  targetId: 'string',
  'nativeType?': 'string',
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
    'storage?': StorageTypeMetadataSchema.array(),
  }),
  'operations?': 'unknown[]',
});

/**
 * Loads the adapter manifest from packs/manifest.json.
 */
function loadAdapterManifest(): ExtensionPackManifest {
  const manifestPath = join(__dirname, '../../packs/manifest.json');
  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid adapter manifest structure at ${manifestPath}: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

/**
 * SQL runtime adapter interface for Postgres.
 * Extends RuntimeAdapterInstance with SQL-specific adapter methods.
 */
export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {}

/**
 * Postgres adapter descriptor for runtime plane.
 */
const postgresRuntimeAdapterDescriptor: RuntimeAdapterDescriptor<
  'sql',
  'postgres',
  SqlRuntimeAdapter
> = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest: loadAdapterManifest(),
  create(): SqlRuntimeAdapter {
    return createPostgresAdapter() as unknown as SqlRuntimeAdapter;
  },
};

export default postgresRuntimeAdapterDescriptor;
