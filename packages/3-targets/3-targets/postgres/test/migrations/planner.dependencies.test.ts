import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

describe('PostgresMigrationPlanner - framework dependency ordering', () => {
  it('emits init database dependency operations in dependency id order', () => {
    const planner = createPostgresMigrationPlanner();

    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:contract',
      storage: { tables: {} },
      models: {},
      relations: {},
      mappings: { codecTypes: {}, operationTypes: {} },
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    };

    const schema: SqlSchemaIR = { tables: {}, extensions: [] };

    const depBOp = createInstallOp('dependency.b.install', 'b');
    const depAOp = createInstallOp('dependency.a.install', 'a');

    type DependencyProviderComponent = TargetBoundComponentDescriptor<'sql', 'postgres'> & {
      readonly databaseDependencies: {
        readonly init: readonly {
          readonly id: string;
          readonly label: string;
          readonly install: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
          readonly verifyDatabaseDependencyInstalled: (
            schema: SqlSchemaIR,
          ) => readonly SchemaIssue[];
        }[];
      };
    };

    const component = {
      kind: 'extension',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'test-dependency-component',
      version: '0.0.0',
      databaseDependencies: {
        init: [
          {
            id: 'b',
            label: 'b',
            install: [depBOp],
            verifyDatabaseDependencyInstalled: (_schema: SqlSchemaIR) => [
              missingTableIssue('b_table'),
            ],
          },
          {
            id: 'a',
            label: 'a',
            install: [depAOp],
            verifyDatabaseDependencyInstalled: (_schema: SqlSchemaIR) => [
              missingTableIssue('a_table'),
            ],
          },
        ],
      },
    } satisfies DependencyProviderComponent;

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [component],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }

    const ids = result.plan.operations.map((op) => op.id);
    expect(ids.slice(0, 2)).toEqual(['dependency.a.install', 'dependency.b.install']);
  });
});

function createInstallOp(
  id: string,
  name: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id,
    label: `Install ${name}`,
    summary: `Installs ${name}`,
    operationClass: 'additive',
    target: {
      id: 'postgres',
      details: {
        schema: 'public',
        objectType: 'extension',
        name,
      },
    },
    precheck: [],
    execute: [],
    postcheck: [],
  };
}

function missingTableIssue(table: string): SchemaIssue {
  return {
    kind: 'missing_table',
    table,
    message: `missing table ${table}`,
  };
}
