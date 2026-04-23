import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import { contractToSchemaIR, extractCodecControlHooks } from '@prisma-next/family-sql/control';
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
import { postgresEmit } from '../core/migrations/postgres-emit';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

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
    // Mirror `renderExpectedNativeType` in verify-sql-schema: when a codec
    // has no `expandNativeType` hook (e.g. `pg/enum@1`, whose typeParams
    // describe the value set rather than a DDL suffix), fall back to the
    // bare native type rather than throwing. Throwing here would reject
    // every plan involving an enum-/values-typed column as soon as its
    // `typeRef` resolved to a `StorageTypeInstance` carrying typeParams.
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
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance) {
        return createPostgresMigrationPlanner();
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      contractToSchema(contract, frameworkComponents) {
        const expander = buildNativeTypeExpander(frameworkComponents);
        return contractToSchemaIR(contract as Contract<SqlStorage> | null, {
          annotationNamespace: 'pg',
          ...ifDefined('expandNativeType', expander),
          renderDefault: postgresRenderDefault,
          frameworkComponents: frameworkComponents ?? [],
        });
      },
      emit: postgresEmit,
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
