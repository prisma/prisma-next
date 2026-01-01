import { assertManifestMatchesDescriptor } from '@prisma-next/contract/descriptor-manifest';
import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { manifest } from '../core/manifest';
import type { PostgresDriverOptions } from '../postgres-driver';
import { createPostgresDriverFromOptions } from '../postgres-driver';

/**
 * Postgres runtime driver instance interface.
 * SqlDriver provides SQL-specific methods (execute, explain, close).
 * RuntimeDriverInstance provides target identification (familyId, targetId).
 * We use intersection type to combine both interfaces.
 */
export type PostgresRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver;

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
  manifest,
  version: manifest.version,
  targets: manifest.targets,
  capabilities: manifest.capabilities,
  types: manifest.types,
  operations: manifest.operations,
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

assertManifestMatchesDescriptor(manifest, postgresRuntimeDriverDescriptor);
