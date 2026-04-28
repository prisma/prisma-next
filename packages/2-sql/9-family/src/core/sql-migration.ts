import { Migration } from '@prisma-next/migration-tools/migration';
import type { AnySqlMigrationOperation, SqlPlanTargetDetails } from './migrations/types';

/**
 * Family-owned base class for SQL migrations.
 *
 * Parameterized on the target-details shape because SQL-family targets
 * (Postgres, MySQL, SQLite, …) each carry their own `target.details` payload
 * on `SqlMigrationPlanOperation`. The type parameter is narrowed to
 * `SqlPlanTargetDetails` so every target-specific shape must at minimum
 * identify the object being targeted (schema + name); concrete targets
 * extend the shape with their own fields.
 *
 * Each concrete target-side subclass (e.g. Postgres's
 * `TypeScriptRenderablePostgresMigration`) fixes `targetId` to its own
 * target-id string literal, since SQL can't hardcode a single `targetId`:
 * `targetId` is a target-level identity, not a family-level one, and
 * belongs on the subclass.
 *
 * `familyId` is intentionally not declared here. The SQL family has no
 * family-scoped runtime identity today — consumers reach the family via
 * target descriptors rather than by family-id lookup, so adding one would
 * be purely decorative. Introducing it later is a non-breaking superset.
 *
 * The operation type parameter is `AnySqlMigrationOperation<TDetails>` — the
 * union of DDL-shaped `SqlMigrationPlanOperation` and `DataTransformOperation`
 * — so subclasses can return a mix of schema operations (e.g. `setNotNull`,
 * `addColumn`) and data-transform operations (e.g. `dataTransform`). Mirrors
 * `MongoMigration`'s parameterization on `AnyMongoMigrationOperation`.
 */
export abstract class SqlMigration<
  TDetails extends SqlPlanTargetDetails,
  TTargetId extends string = string,
> extends Migration<AnySqlMigrationOperation<TDetails>, 'sql', TTargetId> {}
