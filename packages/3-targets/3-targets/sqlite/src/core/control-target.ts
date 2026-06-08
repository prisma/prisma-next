import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type { SqlControlTargetDescriptor } from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@prisma-next/framework-components/control';
import { SqlStorage, type StorageColumn } from '@prisma-next/sql-contract/types';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';
import { createSqliteMigrationPlanner } from './migrations/planner';
import { renderDefaultLiteral } from './migrations/planner-ddl-builders';
import type { SqlitePlanTargetDetails } from './migrations/planner-target-details';
import { createSqliteMigrationRunner } from './migrations/runner';
import { SqliteContractSerializer } from './sqlite-contract-serializer';
import { SqliteSchemaVerifier } from './sqlite-schema-verifier';

function isSqlContract(contract: Contract | null): contract is Contract<SqlStorage> | null {
  return contract === null || contract.storage instanceof SqlStorage;
}

function sqliteRenderDefault(def: ColumnDefault, _column: StorageColumn): string {
  if (def.kind === 'function') {
    if (def.expression === 'now()') {
      return "datetime('now')";
    }
    return def.expression;
  }
  return renderDefaultLiteral(def.value);
}

const sqliteControlTargetDescriptor: SqlControlTargetDescriptor<'sqlite', SqlitePlanTargetDetails> =
  {
    ...sqliteTargetDescriptorMeta,
    contractSerializer: new SqliteContractSerializer(),
    schemaVerifier: new SqliteSchemaVerifier(),
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'sqlite'>): MigrationPlanner<'sql', 'sqlite'> {
        return createSqliteMigrationPlanner(adapter);
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
    createPlanner(adapter: SqlControlAdapter<'sqlite'>) {
      return createSqliteMigrationPlanner(adapter);
    },
    createRunner(family) {
      return createSqliteMigrationRunner(family);
    },
  };

export default sqliteControlTargetDescriptor;
