import type { Contract } from '@prisma-next/contract/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/framework-components/control';
import {
  type ColumnDefault,
  SqlStorage,
  type StorageColumn,
} from '@prisma-next/sql-contract/types';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';
import { createSqliteMigrationPlanner } from './migrations/planner';
import type { SqlitePlanTargetDetails } from './migrations/planner-target-details';
import { createSqliteMigrationRunner } from './migrations/runner';
import { SqliteContractSerializer } from './sqlite-contract-serializer';
import { SqliteSchemaVerifier } from './sqlite-schema-verifier';

function isSqlContract(contract: Contract | null): contract is Contract<SqlStorage> | null {
  return contract === null || contract.storage instanceof SqlStorage;
}

function sqliteRenderDefault(def: ColumnDefault, _column: StorageColumn): string {
  if (def.kind === 'autoincrement') {
    return 'INTEGER PRIMARY KEY AUTOINCREMENT';
  }
  if (def.expression === 'now()') {
    return "datetime('now')";
  }
  return def.expression;
}

const sqliteControlTargetDescriptor: SqlControlTargetDescriptor<'sqlite', SqlitePlanTargetDetails> =
  {
    ...sqliteTargetDescriptorMeta,
    contractSerializer: new SqliteContractSerializer(),
    schemaVerifier: new SqliteSchemaVerifier(),
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance): MigrationPlanner<'sql', 'sqlite'> {
        return createSqliteMigrationPlanner();
      },
      createRunner(family) {
        return createSqliteMigrationRunner(family) as MigrationRunner<'sql', 'sqlite'>;
      },
      contractToSchema(contract, _frameworkComponents) {
        // The framework SPI types `contract` as the generic
        // `Contract | null`. Any contract reaching the sqlite
        // target descriptor is SQL-family by construction (the
        // family contract resolver would have refused to bind a
        // sqlite target otherwise); the `isSqlContract` predicate
        // encodes that invariant at runtime + narrows the generic
        // to `Contract<SqlStorage>` without a blind cast.
        if (!isSqlContract(contract)) {
          throw new Error(
            'sqliteControlTargetDescriptor.contractToSchema received a non-SQL contract; expected Contract<SqlStorage>',
          );
        }
        return contractToSchemaIR(contract, {
          annotationNamespace: 'sqlite',
          renderDefault: sqliteRenderDefault,
        });
      },
    },
    create(): ControlTargetInstance<'sql', 'sqlite'> {
      return {
        familyId: 'sql',
        targetId: 'sqlite',
      };
    },
    createPlanner(_family: SqlControlFamilyInstance) {
      return createSqliteMigrationPlanner();
    },
    createRunner(family) {
      return createSqliteMigrationRunner(family);
    },
  };

export default sqliteControlTargetDescriptor;
