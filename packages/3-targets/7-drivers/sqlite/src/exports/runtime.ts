import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { sqliteDriverDescriptorMeta } from '../core/descriptor-meta';
import type { SqliteDriverOptions } from '../sqlite-driver';
import { createSqliteDriverFromOptions } from '../sqlite-driver';

/**
 * SQLite runtime driver instance interface.
 * SqlDriver provides SQL-specific methods (execute, explain, close).
 * RuntimeDriverInstance provides target identification (familyId, targetId).
 */
export type SqliteRuntimeDriver = RuntimeDriverInstance<'sql', 'sqlite'> & SqlDriver;

/**
 * SQLite driver descriptor for runtime plane.
 */
const sqliteRuntimeDriverDescriptor: RuntimeDriverDescriptor<'sql', 'sqlite', SqliteRuntimeDriver> =
  {
    ...sqliteDriverDescriptorMeta,
    create(options: SqliteDriverOptions): SqliteRuntimeDriver {
      return createSqliteDriverFromOptions(options) as SqliteRuntimeDriver;
    },
  };

export default sqliteRuntimeDriverDescriptor;
export type { CreateSqliteDriverOptions, SqliteDriverOptions } from '../sqlite-driver';
export { createSqliteDriver, createSqliteDriverFromOptions } from '../sqlite-driver';
