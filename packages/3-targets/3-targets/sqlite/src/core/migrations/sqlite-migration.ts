import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { SqlitePlanTargetDetails } from './planner-target-details';

/**
 * Target-owned base class for SQLite migrations. Fixes the `SqlMigration`
 * generic to `SqlitePlanTargetDetails` and the abstract `targetId` to the
 * SQLite literal, so both user-authored migrations and renderer-generated
 * scaffolds can extend `SqliteMigration` directly without redeclaring
 * target-local identity.
 */
export abstract class SqliteMigration extends SqlMigration<SqlitePlanTargetDetails> {
  readonly targetId = 'sqlite' as const;
}
