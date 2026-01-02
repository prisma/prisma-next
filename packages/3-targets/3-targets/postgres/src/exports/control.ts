import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

/**
 * Postgres target descriptor for CLI config.
 */
const postgresTargetDescriptor: SqlControlTargetDescriptor<'postgres', PostgresPlanTargetDetails> =
  {
    kind: 'target',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'postgres',
    version: '0.0.1',
    capabilities: {},
    /**
     * Migrations capability for CLI to access planner/runner via core types.
     * The SQL-specific planner/runner types are compatible with the generic
     * MigrationPlanner/MigrationRunner interfaces at runtime.
     */
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance) {
        return createPostgresMigrationPlanner() as MigrationPlanner<'sql', 'postgres'>;
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
    },
    create(): ControlTargetInstance<'sql', 'postgres'> {
      return {
        familyId: 'sql',
        targetId: 'postgres',
      };
    },
    /**
     * Direct method for SQL-specific usage.
     * @deprecated Use migrations.createPlanner() for CLI compatibility.
     */
    createPlanner(_family: SqlControlFamilyInstance) {
      return createPostgresMigrationPlanner();
    },
    /**
     * Direct method for SQL-specific usage.
     * @deprecated Use migrations.createRunner() for CLI compatibility.
     */
    createRunner(family) {
      return createPostgresMigrationRunner(family);
    },
  };

export default postgresTargetDescriptor;
