import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { OperationExpr, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = validateContract<PostgresContract>({
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'test-hash',
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          vector: { codecId: 'pgvector/vector@1', nativeType: 'vector', nullable: false },
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

  it('lowers operation with literal string argument with quotes', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'test',
      forTypeId: 'pg/text@1',
      self: { kind: 'col', table: 'user', column: 'email' },
      args: [{ kind: 'literal', value: "test'value" }],
      returns: { kind: 'builtin', type: 'boolean' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'result', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('test("user"."email", \'test\'\'value\')');
  });

  it('lowers operation with literal number argument', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [{ kind: 'literal', value: 42 }],
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
    expect(lowered.body.sql).toContain('"user"."vector" <=> 42');
  });

  it('lowers operation with literal boolean argument', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'test',
      forTypeId: 'pg/bool@1',
      self: { kind: 'col', table: 'user', column: 'active' },
      args: [{ kind: 'literal', value: true }],
      returns: { kind: 'builtin', type: 'boolean' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'result', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('test("user"."active", true)');
  });

  it('lowers operation with literal null argument', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'test',
      forTypeId: 'pg/text@1',
      self: { kind: 'col', table: 'user', column: 'email' },
      args: [{ kind: 'literal', value: null }],
      returns: { kind: 'builtin', type: 'boolean' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'result', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('test("user"."email", NULL)');
  });

  it('lowers operation with literal object argument', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'test',
      forTypeId: 'pg/jsonb@1',
      self: { kind: 'col', table: 'user', column: 'data' },
      args: [{ kind: 'literal', value: { key: 'value' } }],
      returns: { kind: 'builtin', type: 'boolean' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0})',
      },
    };

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'result', expr: operationExpr }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('test("user"."data",');
    expect(lowered.body.sql).toContain('{"key":"value"}');
  });

  it('lowers operation with nested operation argument', () => {
    const innerOperation: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [],
      returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const outerOperation: OperationExpr = {
      kind: 'operation',
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col', table: 'user', column: 'vector' },
      args: [innerOperation],
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
      project: [{ alias: 'distance', expr: outerOperation }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain('"user"."vector" <=> normalize("user"."vector")');
  });

  it('throws error for unsupported argument kind in operation', () => {
    const operationExpr = {
      kind: 'operation' as const,
      method: 'cosineDistance',
      forTypeId: 'pgvector/vector@1',
      self: { kind: 'col' as const, table: 'user', column: 'vector' },
      args: [{ kind: 'invalid' as 'param', index: 1 }],
      returns: { kind: 'builtin' as const, type: 'number' as const },
      lowering: {
        targetFamily: 'sql' as const,
        strategy: 'infix' as const,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    } as OperationExpr;

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'distance', expr: operationExpr }],
    };

    expect(() => {
      adapter.lower(ast, { contract, params: [42] });
    }).toThrow('Unsupported argument kind');
  });
});
