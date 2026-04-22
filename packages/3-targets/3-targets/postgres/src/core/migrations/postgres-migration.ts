import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { PostgresPlanTargetDetails } from './planner-target-details';

/**
 * Target-owned base class for class-flow Postgres migrations.
 *
 * Fixes the `SqlMigration` generic to `PostgresPlanTargetDetails` and the
 * abstract `targetId` to the Postgres target-id string literal, so both
 * user-authored migrations and renderer-generated scaffolds (the output of
 * `renderCallsToTypeScript`) can extend `PostgresMigration` directly without
 * redeclaring target-local identity.
 *
 * Mirrors `MongoMigration` in `@prisma-next/family-mongo`: the renderer
 * emits `extends Migration` against a target-specific re-export of this
 * class from `@prisma-next/target-postgres/migration`, keeping the
 * authoring surface target-scoped rather than family-scoped.
 */
export abstract class PostgresMigration extends SqlMigration<PostgresPlanTargetDetails> {
  readonly targetId = 'postgres' as const;
}
