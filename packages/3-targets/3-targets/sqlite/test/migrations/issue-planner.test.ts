import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { planIssues } from '../../src/core/migrations/issue-planner';

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

const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

const baseCtx = {
  codecHooks: new Map(),
  storageTypes: {},
  fromContract: null,
};

describe('planIssues — mapIssueToCall per issue kind', () => {
  describe('missing_table', () => {
    it('emits CreateTableCall + per-index CreateIndexCall', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
              email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'] }],
            foreignKeys: [],
          },
        },
      });

      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'user', message: 'Table "user" is missing' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(2);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createTable',
        tableName: 'user',
        operationClass: 'additive',
      });
      expect(result.value.calls[1]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'user',
        indexName: 'user_email_idx',
      });
    });

    it('appends a CreateIndexCall for an FK with index=true (no explicit index covering the columns)', () => {
      const toContract = makeContract({
        tables: {
          post: {
            columns: {
              id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
              userId: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                index: true,
                constraint: true,
              },
            ],
          },
        },
      });

      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'post', message: 'Table "post" is missing' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(2);
      expect(result.value.calls[1]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'post',
        indexName: 'post_userId_idx',
      });
    });

    it('skips the FK-derived index when an explicit index already covers the column set', () => {
      const toContract = makeContract({
        tables: {
          post: {
            columns: {
              id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
              userId: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['userId'], name: 'idx_explicit' }],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                index: true,
                constraint: true,
              },
            ],
          },
        },
      });

      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'post', message: 'Table "post" is missing' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      // CreateTable + 1 CreateIndex (the explicit one) — the FK-derived
      // duplicate is deduped on column set.
      expect(result.value.calls).toHaveLength(2);
      expect(result.value.calls[1]).toMatchObject({
        factoryName: 'createIndex',
        indexName: 'idx_explicit',
      });
    });

    it('returns conflict when issue.table is missing', () => {
      const issues: SchemaIssue[] = [
        // intentionally omit `table` to exercise the guard
        { kind: 'missing_table', message: 'malformed issue' } as SchemaIssue,
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failure[0]?.kind).toBe('unsupportedOperation');
    });

    it('returns conflict when contract lacks the missing table (mismatched issue input)', () => {
      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'ghost', message: 'Table "ghost" is missing' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failure[0]?.summary).toContain('not found in destination contract');
    });
  });

  describe('missing_column', () => {
    it('emits AddColumnCall', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
              bio: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
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
          kind: 'missing_column',
          table: 'user',
          column: 'bio',
          message: 'Column "bio" is missing',
        },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'addColumn',
        tableName: 'user',
        columnName: 'bio',
      });
    });
  });

  describe('index_mismatch (missing)', () => {
    it('emits CreateIndexCall with explicit name when contract declares one', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['id'], name: 'idx_explicit' }],
            foreignKeys: [],
          },
        },
      });

      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'user',
          expected: 'id',
          message: 'Table "user" is missing index: id',
        },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        indexName: 'idx_explicit',
      });
    });

    it('emits a CreateIndexCall with the default name when no explicit index but a contract FK matches', () => {
      const toContract = makeContract({
        tables: {
          post: {
            columns: {
              userId: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                index: true,
                constraint: true,
              },
            ],
          },
        },
      });

      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'post',
          expected: 'userId',
          message: 'Table "post" is missing index: userId',
        },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract,
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        indexName: 'post_userId_idx',
      });
    });

    it('returns indexIncompatible conflict for non-missing index mismatch (drift)', () => {
      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'user',
          expected: 'email',
          actual: 'name',
          message: 'Index drift on user',
        },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failure[0]).toMatchObject({
        kind: 'indexIncompatible',
        location: { table: 'user' },
      });
    });
  });

  describe('extra_table', () => {
    it('emits DropTableCall for user-table', () => {
      const issues: SchemaIssue[] = [
        { kind: 'extra_table', table: 'orphan', message: 'Extra table' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'dropTable',
        tableName: 'orphan',
      });
    });

    it('skips control tables (_prisma_marker, _prisma_ledger) without emitting a drop or a conflict', () => {
      const issues: SchemaIssue[] = [
        { kind: 'extra_table', table: '_prisma_marker', message: 'Extra table' },
        { kind: 'extra_table', table: '_prisma_ledger', message: 'Extra table' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(0);
    });

    it('does NOT skip stale temp tables (_prisma_new_*) — those are dropped', () => {
      const issues: SchemaIssue[] = [
        { kind: 'extra_table', table: '_prisma_new_user', message: 'Stale temp table' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'dropTable',
        tableName: '_prisma_new_user',
      });
    });
  });

  describe('extra_column', () => {
    it('emits DropColumnCall', () => {
      const issues: SchemaIssue[] = [
        { kind: 'extra_column', table: 'user', column: 'old', message: 'Extra column' },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'dropColumn',
        tableName: 'user',
        columnName: 'old',
      });
    });
  });

  describe('extra_index', () => {
    it('emits DropIndexCall', () => {
      const issues: SchemaIssue[] = [
        {
          kind: 'extra_index',
          table: 'user',
          indexOrConstraint: 'idx_old',
          message: 'Extra index',
        },
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'dropIndex',
        tableName: 'user',
        indexName: 'idx_old',
      });
    });
  });

  describe('unhandled kinds', () => {
    it('returns unsupportedOperation conflict for type_missing (SQLite has no enums/types)', () => {
      const issues: SchemaIssue[] = [
        { kind: 'type_missing', typeName: 'Status', message: 'Type missing' } as SchemaIssue,
      ];

      const result = planIssues({
        ...baseCtx,
        issues,
        toContract: makeContract(),
        schema: emptySchema,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failure[0]?.kind).toBe('unsupportedOperation');
      expect(result.failure[0]?.summary).toContain('Unhandled issue kind');
    });
  });
});

describe('planIssues — emission order and bucketing', () => {
  it('orders calls: create-table → add-column → create-index → drop-column → drop-index → drop-table', () => {
    const toContract = makeContract({
      tables: {
        a: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['email'] }],
          foreignKeys: [],
        },
        b: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            new_col: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const schema: SqlSchemaIR = {
      tables: {
        b: {
          name: 'b',
          columns: {
            id: { name: 'id', nativeType: 'INTEGER', nullable: false },
            // schema lacks `new_col` (will be added) and has an `extra_col` (will be dropped)
            extra_col: { name: 'extra_col', nativeType: 'TEXT', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        c_orphan: {
          name: 'c_orphan',
          columns: { id: { name: 'id', nativeType: 'INTEGER', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const issues: SchemaIssue[] = [
      // Mixed order — issue planner should sort and bucket them.
      { kind: 'extra_table', table: 'c_orphan', message: 'Extra' },
      { kind: 'missing_table', table: 'a', message: 'Missing' },
      { kind: 'extra_column', table: 'b', column: 'extra_col', message: 'Extra' },
      { kind: 'missing_column', table: 'b', column: 'new_col', message: 'Missing' },
    ];

    const result = planIssues({
      ...baseCtx,
      issues,
      toContract,
      schema,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const factoryOrder = result.value.calls.map((c) => c.factoryName);

    // Expected order: createTable(a), addColumn(b.new_col), createIndex(a.email), dropColumn(b.extra_col), dropTable(c_orphan)
    expect(factoryOrder).toEqual([
      'createTable',
      'addColumn',
      'createIndex',
      'dropColumn',
      'dropTable',
    ]);
  });
});

describe('planIssues — policy gating', () => {
  it('surfaces a per-issue conflict when destructive issue arrives under additive-only policy', () => {
    const issues: SchemaIssue[] = [
      { kind: 'extra_column', table: 'user', column: 'gone', message: 'Extra column' },
    ];

    const result = planIssues({
      ...baseCtx,
      issues,
      toContract: makeContract(),
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure[0]?.summary).toContain('"destructive"');
  });
});
