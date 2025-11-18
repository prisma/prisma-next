import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  ControlDriverDescriptor,
  ControlDriverInstance,
  DriverDescriptor,
} from '@prisma-next/core-control-plane/types';
import { type } from 'arktype';
import { Client } from 'pg';

/**
 * Postgres control driver instance for control-plane operations.
 * Implements ControlDriverInstance<'postgres'> for database queries.
 */
export class PostgresControlDriver implements ControlDriverInstance<'postgres'> {
  readonly targetId = 'postgres' as const;
  /**
   * @deprecated Use targetId instead
   */
  readonly target = 'postgres' as const;

  constructor(private readonly client: Client) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    const result = await this.client.query(sql, params as unknown[] | undefined);
    return { rows: result.rows as Row[] };
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

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
 * Implements both legacy DriverDescriptor and new ControlDriverDescriptor for backward compatibility.
 */
const postgresDriverDescriptor: DriverDescriptor &
  ControlDriverDescriptor<'sql', 'postgres', PostgresControlDriver> = {
  kind: 'driver',
  id: 'postgres',
  family: 'sql',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: loadDriverManifest(),
  async create(url: string): Promise<PostgresControlDriver> {
    const client = new Client({ connectionString: url });
    await client.connect();
    return new PostgresControlDriver(client);
  },
};

export default postgresDriverDescriptor;
