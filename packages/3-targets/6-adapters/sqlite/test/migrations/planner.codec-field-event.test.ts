import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { createSqliteMigrationPlanner } from '@prisma-next/target-sqlite/planner';
import { describe, expect, it } from 'vitest';

const HOOKED_CODEC = 'cs/string@1';

function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return { nativeType: 'text', nullable: false, ...overrides };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return { columns, uniques: [], indexes: [], foreignKeys: [] };
}

function contract(tables: Record<string, StorageTable>, hash = 'sha256:c'): Contract<SqlStorage> {
  return {
    target: 'sqlite',
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
      targetId: 'sqlite',
      version: '0.0.0-test',
      types: { codecTypes: { controlPlaneHooks: { [HOOKED_CODEC]: hooks } } },
    } as TargetBoundComponentDescriptor<'sql', string>,
  ];
}

describe('SqliteMigrationPlanner - codec onFieldEvent wiring', () => {
  const planner = createSqliteMigrationPlanner();

  it('inlines ops emitted by onFieldEvent after structural DDL', () => {
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        {
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'sqlite' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        },
      ],
    };

    const result = planner.plan({
      contract: contract(
        {
          User: table({
            id: col({ codecId: 'sqlite/text@1' }),
            email: col({ codecId: HOOKED_CODEC }),
          }),
        },
        'sha256:to',
      ),
      schema: { tables: {}, dependencies: [] },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: makeFrameworkComponents(hooks),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = result.plan.operations.map((op) => op.id);
    expect(ids[ids.length - 1]).toBe('codec.added.User.email');
    expect(ids).toContain('table.User');
  });

  it('does not fire when no codec has an onFieldEvent hook', () => {
    const result = planner.plan({
      contract: contract(
        {
          User: table({ id: col({ codecId: 'sqlite/text@1' }) }),
        },
        'sha256:to',
      ),
      schema: { tables: {}, dependencies: [] },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.plan.operations.every((op) => !op.id.startsWith('codec.'))).toBe(true);
  });

  it('produces byte-identical operations across re-emits (deterministic)', () => {
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        {
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: 'hook',
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'sqlite' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        },
      ],
    };
    const fc = makeFrameworkComponents(hooks);

    const c = contract(
      {
        User: table({
          id: col({ codecId: 'sqlite/text@1' }),
          email: col({ codecId: HOOKED_CODEC }),
          name: col({ codecId: HOOKED_CODEC }),
        }),
      },
      'sha256:to',
    );

    const a = planner.plan({
      contract: c,
      schema: { tables: {}, dependencies: [] },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: fc,
    });
    const b = planner.plan({
      contract: c,
      schema: { tables: {}, dependencies: [] },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: fc,
    });

    expect(a.kind).toBe('success');
    expect(b.kind).toBe('success');
    if (a.kind !== 'success' || b.kind !== 'success') return;
    expect(JSON.stringify(a.plan.operations)).toBe(JSON.stringify(b.plan.operations));
  });
});
