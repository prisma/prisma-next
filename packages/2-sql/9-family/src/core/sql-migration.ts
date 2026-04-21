import { Migration } from '@prisma-next/migration-tools/migration';
import type { SqlMigrationPlanOperation } from './migrations/types';

/**
 * Family-owned base class for class-flow SQL migrations.
 *
 * Parameterized on the target-details shape because SQL-family targets
 * (Postgres, MySQL, SQLite, …) each carry their own `target.details` payload
 * on `SqlMigrationPlanOperation`. Concrete target-side classes (e.g.
 * Postgres's `TypeScriptRenderablePostgresMigration`) extend this alias
 * with their specific details type and fix `targetId` to the target-id
 * string.
 *
 * Mirrors `@prisma-next/family-mongo`'s `MongoMigration`, except SQL can't
 * hardcode a single `targetId` — concrete migration classes supply it.
 */
export abstract class SqlMigration<TDetails = unknown> extends Migration<
  SqlMigrationPlanOperation<TDetails>
> {}
