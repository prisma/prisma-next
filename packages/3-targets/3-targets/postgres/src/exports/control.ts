import { expandParameterizedNativeType } from '@prisma-next/adapter-postgres/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
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
import { contractToSchemaIR, extractCodecControlHooks } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner, renderDefaultLiteral } from '../core/migrations/planner';
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

    if (!input.codecId) {
      throw new Error(
        `Column declares typeParams for nativeType "${input.nativeType}" but has no codecId. ` +
          'Ensure the column is associated with a codec.',
      );
    }

    const hooks = codecHooks.get(input.codecId);
    if (!hooks?.expandNativeType) {
      throw new Error(
        `Column declares typeParams for nativeType "${input.nativeType}" ` +
          `but no expandNativeType hook is registered for codecId "${input.codecId}". ` +
          'Ensure the extension providing this codec is included in extensionPacks.',
      );
    }
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
    operationSignatures: () => [],
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance) {
        return createPostgresMigrationPlanner() as MigrationPlanner<'sql', 'postgres'>;
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      contractToSchema(contract, frameworkComponents) {
        const expander = buildNativeTypeExpander(frameworkComponents);
        return contractToSchemaIR(contract as SqlContract<SqlStorage> | null, {
          annotationNamespace: 'pg',
          ...ifDefined('expandNativeType', expander),
          renderDefault: postgresRenderDefault,
          frameworkComponents: frameworkComponents ?? [],
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
