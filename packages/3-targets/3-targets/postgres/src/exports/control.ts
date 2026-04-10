import {
  normalizeSchemaNativeType,
  parsePostgresDefault,
} from '@prisma-next/adapter-postgres/control';
import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type {
  SqlControlFamilyInstance,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import {
  collectInitDependencies,
  contractToSchemaIR,
  extractCodecControlHooks,
} from '@prisma-next/family-sql/control';
import { MigrationDescriptorArraySchema } from '@prisma-next/family-sql/operation-descriptors';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
  OperationDescriptor,
} from '@prisma-next/framework-components/control';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import { ifDefined } from '@prisma-next/utils/defined';
import { type } from 'arktype';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { planDescriptors } from '../core/migrations/descriptor-planner';
import { resolveOperations } from '../core/migrations/operation-resolver';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { createPostgresMigrationRunner } from '../core/migrations/runner';

function parseDescriptors(descriptors: readonly OperationDescriptor[]) {
  const result = MigrationDescriptorArraySchema([...descriptors]);
  if (result instanceof type.errors) {
    throw new Error(`Invalid migration descriptors:\n${result.summary}`);
  }
  return result;
}

function collectQueryOperationTypes(
  frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
): Readonly<Record<string, SqlOperationEntry>> {
  const entries: Record<string, SqlOperationEntry> = {};
  if (!frameworkComponents) return entries;
  for (const component of frameworkComponents) {
    const ops = (
      component as {
        queryOperations?: () => ReadonlyArray<{ method: string } & SqlOperationEntry>;
      }
    ).queryOperations?.();
    if (!ops) continue;
    for (const { method, ...entry } of ops) {
      entries[method] = entry;
    }
  }
  return entries;
}

/**
 * Creates a SQL DSL client for migration authoring.
 * Only the fields used by the builder are populated — operations, codecs,
 * and types are unused by sql() and stubbed to satisfy the ExecutionContext type.
 */
function createMigrationClient(
  toContract: Contract<SqlStorage>,
  frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
) {
  const queryOperationTypes = collectQueryOperationTypes(frameworkComponents);
  // sql() only reads contract, queryOperations.entries(), and applyMutationDefaults
  // from the context. The other fields are for runtime execution, not query building.
  return sql({
    context: {
      contract: toContract,
      queryOperations: { entries: () => queryOperationTypes },
      applyMutationDefaults: () => [],
    } as never,
  });
}

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
    migrations: {
      createPlanner(_family: SqlControlFamilyInstance) {
        return createPostgresMigrationPlanner() as MigrationPlanner<'sql', 'postgres'>;
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
      planWithDescriptors(context) {
        const toContract = context.toContract as Contract<SqlStorage>;
        const fromContract = context.fromContract as Contract<SqlStorage> | null;

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
          descriptors: planResult.value.descriptors,
          needsDataMigration: planResult.value.needsDataMigration,
        };
      },

      resolveDescriptors(descriptors, context) {
        const validated = parseDescriptors(descriptors);
        const codecHooks = context.frameworkComponents
          ? extractCodecControlHooks(context.frameworkComponents)
          : new Map();
        const dependencies = context.frameworkComponents
          ? collectInitDependencies(context.frameworkComponents)
          : [];
        const toContract = context.toContract as Contract<SqlStorage>;
        const db = createMigrationClient(toContract, context.frameworkComponents);
        return resolveOperations(validated, {
          toContract,
          schemaName: context.schemaName ?? 'public',
          codecHooks,
          dependencies,
          db,
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
