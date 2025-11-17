import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterDescriptor } from '@prisma-next/cli/config-types';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import { type } from 'arktype';
import { createPostgresAdapter } from './adapter';

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
 * Postgres adapter descriptor for CLI config.
 * Provides a runtime factory for DB-connected commands (e.g., schema verification).
 */
const postgresAdapterDescriptor = {
  kind: 'adapter',
  id: 'postgres',
  family: 'sql',
  manifest: loadAdapterManifest(),
  create: () => createPostgresAdapter(),
};

export default postgresAdapterDescriptor as unknown as AdapterDescriptor<SqlFamilyContext>;
