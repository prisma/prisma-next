import { expandParameterizedNativeType } from '@prisma-next/adapter-postgres/control';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner, renderDefaultLiteral } from '../core/migrations/planner';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

export function postgresRenderDefault(def: ColumnDefault, column: StorageColumn): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  return renderDefaultLiteral(def.value, column);
}

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
      contractToSchema(contract: ContractIR | null) {
        const storage = contract ? (contract.storage as SqlStorage) : { tables: {} };
        return contractToSchemaIR(storage, expandParameterizedNativeType, postgresRenderDefault);
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
