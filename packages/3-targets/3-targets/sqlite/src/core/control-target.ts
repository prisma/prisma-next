import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
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
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';
import { createSqliteMigrationPlanner } from './migrations/planner';
import { renderDefaultLiteral } from './migrations/planner-ddl-builders';
import type { SqlitePlanTargetDetails } from './migrations/planner-target-details';
import { createSqliteMigrationRunner } from './migrations/runner';

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
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance): MigrationPlanner<'sql', 'sqlite'> {
        return createSqliteMigrationPlanner();
      },
      createRunner(family) {
        return createSqliteMigrationRunner(family) as MigrationRunner<'sql', 'sqlite'>;
      },
      contractToSchema(contract, frameworkComponents) {
        return contractToSchemaIR(contract as Contract<SqlStorage> | null, {
          annotationNamespace: 'sqlite',
          renderDefault: sqliteRenderDefault,
          frameworkComponents: frameworkComponents ?? [],
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
