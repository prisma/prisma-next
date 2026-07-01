import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlControlTargetDescriptor } from '@prisma-next/family-sql/control';
import { extractCodecControlHooks } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@prisma-next/framework-components/control';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { contractToPostgresDatabaseSchemaNode } from '../core/migrations/contract-to-postgres-database-schema-node';
import { diffPostgresDatabaseSchema } from '../core/migrations/diff-database-schema';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import type { PostgresContract } from '../core/postgres-schema';
import { PostgresSchemaVerifier } from '../core/postgres-schema-verifier';
import { inferPostgresPslContract } from '../core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../core/schema-ir/postgres-database-schema-node';

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
    inferPslContract(schema) {
      PostgresDatabaseSchemaNode.assert(schema);
      return inferPostgresPslContract(PostgresDatabaseSchemaNode.ensure(schema));
    },
    diffDatabaseSchema(input) {
      return diffPostgresDatabaseSchema({
        contract: input.contract,
        actualSchema: input.schema,
        strict: input.strict,
        typeMetadataRegistry: input.typeMetadataRegistry,
        frameworkComponents: input.frameworkComponents,
      });
    },
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'postgres'>) {
        return createPostgresMigrationPlanner(adapter);
      },
      createRunner(family) {
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      contractToSchema(contract, frameworkComponents) {
        const expander = buildNativeTypeExpander(frameworkComponents);
        const postgresContract = blindCast<
          PostgresContract | null,
          'the family resolver only binds this hook for a Postgres-target contract'
        >(contract);
        return contractToPostgresDatabaseSchemaNode(postgresContract, {
          annotationNamespace: 'pg',
          ...ifDefined('expandNativeType', expander),
          renderDefault: postgresRenderDefault,
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
