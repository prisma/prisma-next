import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ContractDiffResult,
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { contractToSchemaIR, detectDestructiveChanges } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

const postgresTargetDescriptor: SqlControlTargetDescriptor<'postgres', PostgresPlanTargetDetails> =
  {
    ...postgresTargetDescriptorMeta,
    operationSignatures: () => [],
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance) {
        return createPostgresMigrationPlanner() as MigrationPlanner<'sql', 'postgres'>;
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      planContractDiff(from: ContractIR | null, to: ContractIR): ContractDiffResult {
        const fromStorage = from ? (from.storage as SqlStorage) : null;
        const toStorage = to.storage as SqlStorage;

        const destructive = detectDestructiveChanges(fromStorage, toStorage);
        if (destructive.length > 0) {
          return { kind: 'failure', conflicts: destructive };
        }

        const fromSchemaIR = fromStorage
          ? contractToSchemaIR(fromStorage)
          : contractToSchemaIR({ tables: {} });
        const planner = createPostgresMigrationPlanner();
        const result = planner.plan({
          contract: to as SqlContract<SqlStorage>,
          schema: fromSchemaIR,
          policy: { allowedOperationClasses: ['additive'] },
          frameworkComponents: [],
        });
        if (result.kind === 'failure') {
          return { kind: 'failure', conflicts: result.conflicts };
        }
        return { kind: 'success', ops: result.plan.operations };
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
