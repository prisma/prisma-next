import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliDriver, DriverDescriptor } from '@prisma-next/cli/config-types';
import type { ExtensionPackManifest } from '@prisma-next/cli/pack-manifest-types';
import { type } from 'arktype';
import { Client } from 'pg';

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
 * Postgres driver descriptor for CLI config.
 */
const postgresDriverDescriptor: DriverDescriptor = {
  kind: 'driver',
  id: 'postgres',
  family: 'sql',
  manifest: loadDriverManifest(),
  async create(url: string): Promise<CliDriver> {
    const client = new Client({ connectionString: url });
    await client.connect();
    return {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<{ readonly rows: Row[] }> {
        const result = await client.query(sql, params as unknown[] | undefined);
        return { rows: result.rows as Row[] };
      },
      async close(): Promise<void> {
        await client.end();
      },
    };
  },
};

export default postgresDriverDescriptor;
