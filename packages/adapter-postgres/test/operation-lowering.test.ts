import { validateContract } from '@prisma-next/sql-query/schema';
import type { OperationExpr, SelectAst } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/adapter';
import type { PostgresContract } from '../src/types';

const contract = validateContract<PostgresContract>({
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'test-hash',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          vector: { type: 'pgvector/vector@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
});

describe('Operation lowering', () => {
  const adapter = createPostgresAdapter();

  it('lowers infix operation in projection', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'param', index: 1, name: 'other' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'distance', expr: operationExpr },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: [42] });
    expect(lowered.body.sql).toContain('"user"."vector" <=> $1');
    expect(lowered.body.sql).toContain('AS "distance"');
  });

  it('lowers function operation in projection', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineSimilarity',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'param', index: 1, name: 'other' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'cosine_similarity(${self}, ${arg0})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'similarity', expr: operationExpr },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: [42] });
    expect(lowered.body.sql).toContain('cosine_similarity("user"."vector", $1)');
    expect(lowered.body.sql).toContain('AS "similarity"');
  });

  it('lowers operation with multiple arguments', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineSimilarity',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [
        { kind: 'col', table: 'user', column: 'otherVector' },
        { kind: 'param', index: 1, name: 'param' },
        { kind: 'literal', value: 42 },
      ],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'cosine_similarity(${self}, ${arg0}, ${arg1}, ${arg2})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'similarity', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [42] });
    expect(lowered.body.sql).toContain(
      'cosine_similarity("user"."vector", "user"."otherVector", $1, 42)',
    );
  });

  it('lowers operation in where clause', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'param', index: 1, name: 'other' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'eq',
        left: operationExpr,
        right: { kind: 'param', index: 2, name: 'threshold' },
      },
    };

    const lowered = adapter.lower(ast, { contract, params: [42, 0.5] });
    expect(lowered.body.sql).toContain('WHERE ("user"."vector" <=> $1) = $2');
  });

  it('lowers operation in orderBy clause', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'param', index: 1, name: 'other' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      orderBy: [{ expr: operationExpr, dir: 'asc' }],
    };

    const lowered = adapter.lower(ast, { contract, params: [42] });
    expect(lowered.body.sql).toContain('ORDER BY "user"."vector" <=> $1 ASC');
  });

  it('lowers operation with literal argument', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'literal', value: [1, 2, 3] }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'distance', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('"user"."vector" <=>');
  });
});
