import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { expectNarrowedType } from '@prisma-next/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';

const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

const PG_TEXT_CODEC = 'pg/text@1';
const HOOKED_CODEC = 'cs/string@1';

function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return { nativeType: 'text', nullable: false, ...overrides };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return { columns, uniques: [], indexes: [], foreignKeys: [] };
}

function contract(tables: Record<string, StorageTable>, hash = 'sha256:c'): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: { storageHash: coreHash(hash), tables },
    models: {},
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeFrameworkComponents(
  hooks: CodecControlHooks,
): ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> {
  return [
    {
      kind: 'adapter',
      id: 'test-codec',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.0-test',
      types: {
        codecTypes: {
          controlPlaneHooks: {
            [HOOKED_CODEC]: hooks,
          },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', string>,
  ];
}

describe('PostgresMigrationPlanner - codec onFieldEvent wiring', () => {
  it('inlines ops emitted by onFieldEvent after structural DDL', () => {
    const planner = createPostgresMigrationPlanner();

    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        {
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'postgres' },
          precheck: [],
          execute: [{ description: 'codec side-effect', sql: '-- codec side-effect' }],
          postcheck: [],
        },
      ],
    };

    const frameworkComponents = makeFrameworkComponents(hooks);

    const result = planner.plan({
      contract: contract(
        {
          User: table({
            id: col({ codecId: PG_TEXT_CODEC }),
            email: col({ codecId: HOOKED_CODEC }),
          }),
        },
        'sha256:to',
      ),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expectNarrowedType(result.kind === 'success');
    const ids = result.plan.operations.map((op) => op.id);
    expect(ids[ids.length - 1]).toBe('codec.added.User.email');
    expect(ids).toContain('table.User');
  });

  it('does not fire when no codec has an onFieldEvent hook', () => {
    const planner = createPostgresMigrationPlanner();

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> = [];

    const result = planner.plan({
      contract: contract(
        {
          User: table({ id: col({ codecId: PG_TEXT_CODEC }) }),
        },
        'sha256:to',
      ),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expectNarrowedType(result.kind === 'success');
    expect(result.plan.operations.every((op) => !op.id.startsWith('codec.'))).toBe(true);
  });

  it('produces byte-identical operations across re-emits (deterministic)', () => {
    const planner = createPostgresMigrationPlanner();

    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        {
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: 'hook',
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'postgres' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        },
      ],
    };
    const frameworkComponents = makeFrameworkComponents(hooks);

    const c = contract(
      {
        User: table({
          id: col({ codecId: PG_TEXT_CODEC }),
          email: col({ codecId: HOOKED_CODEC }),
          name: col({ codecId: HOOKED_CODEC }),
        }),
      },
      'sha256:to',
    );

    const a = planner.plan({
      contract: c,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    const b = planner.plan({
      contract: c,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expectNarrowedType(a.kind === 'success');
    expectNarrowedType(b.kind === 'success');
    expect(JSON.stringify(a.plan.operations)).toBe(JSON.stringify(b.plan.operations));
  });
});
