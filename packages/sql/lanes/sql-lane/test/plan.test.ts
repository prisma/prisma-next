import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createTableRef } from '@prisma-next/sql-relational-core/ast';
import { createExpressionBuilder } from '@prisma-next/sql-relational-core/expression-builder';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
  JoinOnPredicate,
} from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { buildMeta } from '../src/sql/plan';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('buildMeta', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userTable = tables.user;
  const userColumns = userTable.columns;
  const tableRef = createTableRef('user');

  it('builds meta with operation expressions in projection', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['normalized'],
        columns: [columnWithOp],
      },
      paramDescriptors: [],
    });

    expect(meta.projection).toEqual({
      normalized: 'operation:normalize',
    });
    expect(meta.projectionTypes).toEqual({
      normalized: 'pg/vector@1',
    });
    expect(meta.annotations?.codecs).toEqual({
      normalized: 'pg/vector@1',
    });
  });

  it('builds meta with builtin operation return type', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['distance'],
        columns: [columnWithOp],
      },
      paramDescriptors: [],
    });

    expect(meta.projectionTypes).toEqual({
      distance: 'number',
    });
  });

  it('builds meta with includes', () => {
    const includes = [
      {
        alias: 'posts',
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: userColumns.id,
          right: userColumns.id,
        },
        childProjection: {
          aliases: ['id'],
          columns: [userColumns.id],
        },
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'posts'],
        columns: [
          userColumns.id,
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes,
      paramDescriptors: [],
    });

    expect(meta.projection).toEqual({
      id: 'user.id',
      posts: 'include:posts',
    });
    expect(meta.refs?.tables).toContain('post');
  });

  it('builds meta with joins', () => {
    const joins = [
      {
        joinType: 'inner' as const,
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: userColumns.id,
          right: userColumns.id,
        },
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      joins,
      paramDescriptors: [],
    });

    expect(meta.refs?.tables).toContain('post');
    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with where clause', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      where: userColumns.id.eq(param('userId')),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with orderBy clause', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      orderBy: userColumns.id.asc(),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with paramCodecs', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      paramDescriptors: [],
      paramCodecs: {
        userId: 'pg/int4@1',
      },
    });

    expect(meta.annotations?.codecs).toEqual({
      id: 'pg/int4@1',
      userId: 'pg/int4@1',
    });
  });

  it('handles empty projectionTypes', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['posts'],
        columns: [
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes: [
        {
          alias: 'posts',
          table: createTableRef('post'),
          on: {
            kind: 'join-on' as const,
            left: userColumns.id,
            right: userColumns.id,
          } as unknown as JoinOnPredicate,
          childProjection: {
            aliases: ['id'],
            columns: [userColumns.id],
          },
        },
      ],
      paramDescriptors: [],
    });

    expect(meta.projectionTypes).toBeUndefined();
  });

  it('handles missing column for alias', () => {
    expect(() =>
      buildMeta({
        contract,
        table: tableRef,
        projection: {
          aliases: ['id'],
          columns: [],
        },
        paramDescriptors: [],
      }),
    ).toThrow('Missing column for alias id at index 0');
  });

  it('builds meta with nullCheck predicate in where clause (isNull)', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      where: userColumns.deletedAt.isNull(),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'deletedAt' });
  });

  it('builds meta with nullCheck predicate in where clause (isNotNull)', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      where: userColumns.deletedAt.isNotNull(),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'deletedAt' });
  });

  it('builds meta with operation expression in where clause', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      where: columnWithOp.eq(param('value')),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with operation expression in orderBy clause', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      orderBy: columnWithOp.asc(),
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with includes having child WHERE with nullCheck predicate', () => {
    const includes = [
      {
        alias: 'posts',
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: userColumns.id,
          right: userColumns.id,
        },
        childProjection: {
          aliases: ['id'],
          columns: [userColumns.id],
        },
        childWhere: userColumns.deletedAt.isNull(),
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'posts'],
        columns: [
          userColumns.id,
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes,
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'deletedAt' });
  });

  it('builds meta with includes having child WHERE with column-to-column comparison', () => {
    const includes = [
      {
        alias: 'posts',
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: userColumns.id,
          right: userColumns.id,
        },
        childProjection: {
          aliases: ['id'],
          columns: [userColumns.id],
        },
        childWhere: userColumns.id.eq(userColumns.email as unknown as typeof userColumns.id),
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'posts'],
        columns: [
          userColumns.id,
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes,
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'email' });
  });

  it('builds meta with includes having child ORDER BY with operation expression', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const includes = [
      {
        alias: 'posts',
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: userColumns.id,
          right: userColumns.id,
        },
        childProjection: {
          aliases: ['id'],
          columns: [userColumns.id],
        },
        childOrderBy: columnWithOp.asc(),
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'posts'],
        columns: [
          userColumns.id,
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes,
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
  });

  it('builds meta with ExpressionBuilder columns in projection', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['normalized'],
        columns: [columnWithOp],
      },
      paramDescriptors: [],
    });

    expect(meta.projectionTypes).toEqual({
      normalized: 'pg/vector@1',
    });
    expect(meta.annotations?.codecs).toEqual({
      normalized: 'pg/vector@1',
    });
  });

  it('builds meta with ColumnBuilder columns having codecId', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'email'],
        columns: [userColumns.id, userColumns.email],
      },
      paramDescriptors: [],
    });

    expect(meta.projectionTypes).toEqual({
      id: 'pg/int4@1',
      email: 'pg/text@1',
    });
    expect(meta.annotations?.codecs).toEqual({
      id: 'pg/int4@1',
      email: 'pg/text@1',
    });
  });

  it('handles empty paramCodecs', () => {
    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id'],
        columns: [userColumns.id],
      },
      paramDescriptors: [],
      paramCodecs: {},
    });

    expect(meta.annotations?.codecs).toEqual({
      id: 'pg/int4@1',
    });
  });

  it('builds meta with includes having missing ON condition columns', () => {
    const includes = [
      {
        alias: 'posts',
        table: createTableRef('post'),
        on: {
          kind: 'join-on' as const,
          left: {
            kind: 'column' as const,
            table: '',
            column: '',
            columnMeta: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          } as AnyColumnBuilder,
          right: {
            kind: 'column' as const,
            table: '',
            column: '',
            columnMeta: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          } as AnyColumnBuilder,
        },
        childProjection: {
          aliases: ['id'],
          columns: [userColumns.id],
        },
      },
    ];

    const meta = buildMeta({
      contract,
      table: tableRef,
      projection: {
        aliases: ['id', 'posts'],
        columns: [
          userColumns.id,
          {
            kind: 'column' as const,
            table: 'post',
            column: '',
            columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
          } as AnyColumnBuilder,
        ],
      },
      includes,
      paramDescriptors: [],
    });

    // Should not throw, but ON condition columns won't be added to refs
    expect(meta.refs?.tables).toContain('post');
  });
});
