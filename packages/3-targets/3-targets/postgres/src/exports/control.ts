import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type { SqlControlTargetDescriptor } from '@prisma-next/family-sql/control';
import { extractCodecControlHooks } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { projectPostgresSchemaFromContract } from '../core/migrations/project-postgres-schema-from-contract';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import { PostgresSchemaVerifier } from '../core/postgres-schema-verifier';

function buildNativeTypeExpander(
  frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
) {
  if (!frameworkComponents) {
    return undefined;
  }
  const codecHooks = extractCodecControlHooks(frameworkComponents);
  return (input: {
    readonly nativeType: string;
    readonly codecId?: string;
    readonly typeParams?: Record<string, unknown>;
  }) => {
    if (!input.typeParams) return input.nativeType;
    if (!input.codecId) return input.nativeType;
    const hooks = codecHooks.get(input.codecId);
    if (!hooks?.expandNativeType) return input.nativeType;
    return hooks.expandNativeType(input);
  };
}

export function postgresRenderDefault(def: ColumnDefault, column: StorageColumn): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  return renderDefaultLiteral(def.value, column);
}

const postgresTargetDescriptor: SqlControlTargetDescriptor<'postgres', PostgresPlanTargetDetails> =
  {
    ...postgresTargetDescriptorMeta,
    contractSerializer: new PostgresContractSerializer(),
    schemaVerifier: new PostgresSchemaVerifier(),
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'postgres'>) {
        return createPostgresMigrationPlanner(adapter);
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      contractToSchema(contract, frameworkComponents) {
        const expander = buildNativeTypeExpander(frameworkComponents);
        // Blind cast: the framework SPI signature
        // (`control-migration-types.ts § contractToSchema`) types
        // `contract` as the generic `Contract | null`. Inside the
        // postgres target descriptor we know any contract reaching
        // this method is SQL-family — the family contract resolver
        // would have refused to construct a postgres target binding
        // otherwise — so we narrow the generic to
        // `Contract<SqlStorage>` for the lowering call.
        return projectPostgresSchemaFromContract(
          contract as unknown as Contract<SqlStorage> | null,
          {
            annotationNamespace: 'pg',
            ...ifDefined('expandNativeType', expander),
            renderDefault: postgresRenderDefault,
          },
        );
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
    createPlanner(adapter: SqlControlAdapter<'postgres'>) {
      return createPostgresMigrationPlanner(adapter);
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
