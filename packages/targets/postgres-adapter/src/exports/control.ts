import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { type } from 'arktype';
import { PostgresControlAdapter } from '../core/control-adapter';

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
 */
const postgresAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'postgres',
  SqlControlAdapter<'postgres'>
> = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest: loadAdapterManifest(),
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;
