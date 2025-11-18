import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterDescriptor } from '@prisma-next/cli/config-types';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type {
  SqlControlAdapter,
  SqlControlAdapterDescriptor,
} from '@prisma-next/family-sql/control-adapter';
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
 * Postgres control adapter descriptor.
 * Exported from the control entrypoint for use by family instances.
 * This is the new pattern - the adapter descriptor IS the control adapter descriptor.
 */
const postgresControlAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  create() {
    return new PostgresControlAdapter();
  },
};

/**
 * Postgres adapter descriptor for CLI config.
 * Implements both legacy AdapterDescriptor and new ControlAdapterDescriptor for backward compatibility.
 * Includes reference to control adapter descriptor for legacy compatibility.
 */
const postgresAdapterDescriptor = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest: loadAdapterManifest(),
  // Legacy: control property for backward compatibility
  control: postgresControlAdapterDescriptor,
  // New pattern: create() method returns control adapter instance
  create(): SqlControlAdapter<'postgres'> {
    return postgresControlAdapterDescriptor.create();
  },
} as AdapterDescriptor<'sql'> &
  ControlAdapterDescriptor<
    'sql',
    'postgres',
    SqlControlAdapter<'postgres'> & { readonly familyId: 'sql'; readonly targetId: 'postgres' }
  >;

export default postgresAdapterDescriptor;
export { postgresControlAdapterDescriptor };
