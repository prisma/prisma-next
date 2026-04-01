import {
  normalizeSchemaNativeType,
  parsePostgresDefault,
} from '@prisma-next/adapter-postgres/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
  OperationDescriptor,
} from '@prisma-next/core-control-plane/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import {
  collectInitDependencies,
  contractToSchemaIR,
  extractCodecControlHooks,
} from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { planDescriptors } from '../core/migrations/descriptor-planner';
import { resolveOperations } from '../core/migrations/operation-resolver';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-sql';
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
      planWithDescriptors(context) {
        const toContract = context.toContract as SqlContract<SqlStorage>;
        const fromContract = context.fromContract as SqlContract<SqlStorage> | null;

        // Synthesize schema IR from the fromContract (same as contractToSchema flow)
        const expander = buildNativeTypeExpander(context.frameworkComponents);
        const fromSchemaIR = contractToSchemaIR(fromContract, {
          annotationNamespace: 'pg',
          ...ifDefined('expandNativeType', expander),
          renderDefault: postgresRenderDefault,
          frameworkComponents: context.frameworkComponents ?? [],
        });

        // Collect schema issues via verifier
        const verifyResult = verifySqlSchema({
          contract: toContract,
          schema: fromSchemaIR,
          strict: true,
          typeMetadataRegistry: new Map(),
          frameworkComponents: context.frameworkComponents ?? [],
          normalizeDefault: parsePostgresDefault,
          normalizeNativeType: normalizeSchemaNativeType,
        });

        // Run descriptor planner
        const planResult = planDescriptors({
          issues: verifyResult.schema.issues,
          toContract,
          fromContract,
        });

        if (!planResult.ok) {
          return { ok: false as const, conflicts: planResult.failure };
        }

        return {
          ok: true as const,
          // TODO: fix this cast
          descriptors: planResult.value.descriptors as unknown as OperationDescriptor[],
          needsDataMigration: planResult.value.needsDataMigration,
        };
      },

      resolveDescriptors(descriptors, context) {
        const codecHooks = context.frameworkComponents
          ? extractCodecControlHooks(context.frameworkComponents)
          : new Map();
        const dependencies = context.frameworkComponents
          ? collectInitDependencies(context.frameworkComponents)
          : [];
        // TODO: Due to layering we are passed "some generic descriptors" that could ~technically come from a different target
        // but really these should have been generated by the target-specific planner, we just aren't transmitting this type information
        // all the way through properly
        return resolveOperations(descriptors as never, {
          toContract: context.toContract as SqlContract<SqlStorage>,
          schemaName: context.schemaName ?? 'public',
          codecHooks,
          dependencies,
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
