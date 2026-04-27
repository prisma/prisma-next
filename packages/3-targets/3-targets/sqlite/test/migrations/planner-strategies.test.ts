import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { RecreateTableCall } from '../../src/core/migrations/op-factory-call';
import {
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
  type StrategyContext,
} from '../../src/core/migrations/planner-strategies';

function makeContract(
  overrides: Partial<Contract<SqlStorage>['storage']> = {},
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      storageHash: coreHash('sha256:contract'),
      tables: {},
      ...overrides,
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    toContract: makeContract(),
    fromContract: null,
    codecHooks: new Map(),
    storageTypes: {},
    schema: { tables: {}, dependencies: [] },
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
    ...overrides,
  };
}

const baseTable = {
  name: 'user',
  columns: {
    id: { name: 'id', nativeType: 'INTEGER', nullable: false },
    email: { name: 'email', nativeType: 'TEXT', nullable: true },
  },
  primaryKey: { columns: ['id'] },
  foreignKeys: [],
  uniques: [],
  indexes: [],
};

describe('recreateTableStrategy', () => {
  it('returns no_match when there are no recreate-eligible issues', () => {
    const result = recreateTableStrategy(
      [{ kind: 'missing_column', table: 'user', column: 'x', message: 'm' }],
      makeContext(),
    );
    expect(result.kind).toBe('no_match');
  });

  it('classifies pure default_mismatch as widening', () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: {
              nativeType: 'text',
              codecId: 'sqlite/text@1',
              nullable: true,
              default: { kind: 'literal', value: '' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = { tables: { user: baseTable }, dependencies: [] };

    const issues: SchemaIssue[] = [
      { kind: 'default_mismatch', table: 'user', column: 'email', message: 'differ' },
    ];

    const result = recreateTableStrategy(issues, makeContext({ toContract: contract, schema }));

    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(1);
    const call = result.calls[0] as RecreateTableCall;
    expect(call.factoryName).toBe('recreateTable');
    expect(call.operationClass).toBe('widening');
    expect(call.tableName).toBe('user');
    expect(result.recipe).toBe(true);
    expect(result.issues).toHaveLength(0); // consumed
  });

  it('classifies type_mismatch as destructive', () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = { tables: { user: baseTable }, dependencies: [] };

    const issues: SchemaIssue[] = [
      {
        kind: 'type_mismatch',
        table: 'user',
        column: 'email',
        expected: 'TEXT',
        actual: 'INTEGER',
        message: 'differ',
      },
    ];

    const result = recreateTableStrategy(issues, makeContext({ toContract: contract, schema }));

    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
  });

  it('destructive wins over widening when both kinds occur on same table', () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: {
              nativeType: 'text',
              codecId: 'sqlite/text@1',
              nullable: true,
              default: { kind: 'literal', value: '' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = { tables: { user: baseTable }, dependencies: [] };

    const issues: SchemaIssue[] = [
      { kind: 'default_mismatch', table: 'user', column: 'email', message: 'd' },
      {
        kind: 'type_mismatch',
        table: 'user',
        column: 'email',
        expected: 'TEXT',
        actual: 'INT',
        message: 't',
      },
    ];

    const result = recreateTableStrategy(issues, makeContext({ toContract: contract, schema }));

    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
    // Both consumed.
    expect(result.issues).toHaveLength(0);
  });

  it('relaxing nullability (NOT NULL → nullable) is widening, tightening is destructive', () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = { tables: { user: baseTable }, dependencies: [] };

    const widening = recreateTableStrategy(
      [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'true',
          actual: 'false',
          message: 'm',
        },
      ],
      makeContext({ toContract: contract, schema }),
    );
    expect(widening.kind).toBe('match');
    if (widening.kind !== 'match') return;
    expect((widening.calls[0] as RecreateTableCall).operationClass).toBe('widening');

    const tightening = recreateTableStrategy(
      [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'false',
          actual: 'true',
          message: 'm',
        },
      ],
      makeContext({ toContract: contract, schema }),
    );
    expect(tightening.kind).toBe('match');
    if (tightening.kind !== 'match') return;
    expect((tightening.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
  });

  it('groups issues by table and emits one RecreateTableCall per affected table', () => {
    const contract = makeContract({
      tables: {
        a: {
          columns: { id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        b: {
          columns: { id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = {
      tables: {
        a: { ...baseTable, name: 'a' },
        b: { ...baseTable, name: 'b' },
      },
      dependencies: [],
    };

    const issues: SchemaIssue[] = [
      {
        kind: 'type_mismatch',
        table: 'a',
        column: 'id',
        expected: 'X',
        actual: 'Y',
        message: 'a',
      },
      {
        kind: 'type_mismatch',
        table: 'b',
        column: 'id',
        expected: 'X',
        actual: 'Y',
        message: 'b',
      },
    ];

    const result = recreateTableStrategy(issues, makeContext({ toContract: contract, schema }));
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(2);
    expect(new Set(result.calls.map((c) => (c as RecreateTableCall).tableName))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('skips issues whose table is missing from contract or schema (defensive)', () => {
    const issues: SchemaIssue[] = [
      {
        kind: 'type_mismatch',
        table: 'ghost',
        column: 'x',
        expected: 'X',
        actual: 'Y',
        message: 'ghost',
      },
    ];
    const result = recreateTableStrategy(issues, makeContext());
    // No matching contract+schema table → strategy still consumes the issue
    // (it grouped it) but emits no calls. Caller's mapIssueToCall later sees
    // an empty `issues` list and produces no further output for that table.
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(0);
  });
});

describe('nullabilityTighteningBackfillStrategy', () => {
  it("returns no_match when policy does not include 'data'", () => {
    const result = nullabilityTighteningBackfillStrategy(
      [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'false',
          actual: 'true',
          message: 'm',
        },
      ],
      makeContext({ policy: { allowedOperationClasses: ['additive', 'destructive'] } }),
    );
    expect(result.kind).toBe('no_match');
  });

  it("returns no_match for relaxing nullability under 'data' policy", () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const result = nullabilityTighteningBackfillStrategy(
      [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'true', // relaxing
          actual: 'false',
          message: 'm',
        },
      ],
      makeContext({
        toContract: contract,
        policy: { allowedOperationClasses: ['additive', 'data', 'widening'] },
      }),
    );
    expect(result.kind).toBe('no_match');
  });

  it("emits DataTransformCall per tightened column under 'data' policy without consuming the issue", () => {
    const contract = makeContract({
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false }, // contract: NOT NULL
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const issues: SchemaIssue[] = [
      {
        kind: 'nullability_mismatch',
        table: 'user',
        column: 'email',
        expected: 'false', // tightening
        actual: 'true',
        message: 'm',
      },
    ];

    const result = nullabilityTighteningBackfillStrategy(
      issues,
      makeContext({
        toContract: contract,
        policy: { allowedOperationClasses: ['additive', 'destructive', 'data'] },
      }),
    );

    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.factoryName).toBe('dataTransform');
    expect(result.calls[0]?.operationClass).toBe('data');
    expect(result.recipe).toBe(true);
    // Issue NOT consumed — recreateTableStrategy still needs to handle the
    // actual schema-level NOT NULL.
    expect(result.issues).toEqual(issues);
  });
});
