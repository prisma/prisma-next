import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';
import type { SqlitePlanTargetDetails } from '../core/migrations/planner';
import { createSqliteMigrationPlanner } from '../core/migrations/planner';
import { createSqliteMigrationRunner } from '../core/migrations/runner';

/**
 * SQLite target descriptor for CLI config.
 */
const sqliteTargetDescriptor: SqlControlTargetDescriptor<'sqlite', SqlitePlanTargetDetails> = {
  ...sqliteTargetDescriptorMeta,
  /**
   * Migrations capability for CLI to access planner/runner via core types.
   * The SQL-specific planner/runner types are compatible with the generic
   * MigrationPlanner/MigrationRunner interfaces at runtime.
   */
  migrations: {
    createPlanner(_family: SqlControlFamilyInstance) {
      return createSqliteMigrationPlanner() as MigrationPlanner<'sql', 'sqlite'>;
    },
    createRunner(family) {
      return createSqliteMigrationRunner(family) as MigrationRunner<'sql', 'sqlite'>;
    },
  },
  create(): ControlTargetInstance<'sql', 'sqlite'> {
    return {
      familyId: 'sql',
      targetId: 'sqlite',
    };
  },
  /**
   * Direct method for SQL-specific usage.
   * @deprecated Use migrations.createPlanner() for CLI compatibility.
   */
  createPlanner(_family: SqlControlFamilyInstance) {
    return createSqliteMigrationPlanner();
  },
  /**
   * Direct method for SQL-specific usage.
   * @deprecated Use migrations.createRunner() for CLI compatibility.
   */
  createRunner(family) {
    return createSqliteMigrationRunner(family);
  },
};

export default sqliteTargetDescriptor;
