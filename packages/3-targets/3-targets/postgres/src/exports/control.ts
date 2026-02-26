import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { planContractDiff } from '@prisma-next/family-sql/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { createPostgresSqlEmitter } from '../core/migrations/postgres-sql-emitter';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

const postgresTargetDescriptor: SqlControlTargetDescriptor<'postgres', PostgresPlanTargetDetails> =
  {
    ...postgresTargetDescriptorMeta,
    operationSignatures: () => [],
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
      planContractDiff(from: ContractIR | null, to: ContractIR) {
        const emitter = createPostgresSqlEmitter();
        return planContractDiff({
          from: from ? (from.storage as SqlStorage) : null,
          to: to.storage as SqlStorage,
          emitter,
        });
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
