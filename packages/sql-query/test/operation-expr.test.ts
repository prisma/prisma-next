import { describe, expect, it } from 'vitest';
import type { OperationExpr, SelectAst } from '../src/types';

describe('OperationExpr', () => {
  it('defines OperationExpr with infix strategy', () => {
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

    expect(operationExpr.kind).toBe('operation');
    expect(operationExpr.method).toBe('cosineDistance');
    expect(operationExpr.lowering.strategy).toBe('infix');
  });

  it('defines OperationExpr with function strategy', () => {
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

    expect(operationExpr.kind).toBe('operation');
    expect(operationExpr.method).toBe('cosineSimilarity');
    expect(operationExpr.lowering.strategy).toBe('function');
  });

  it('defines OperationExpr with multiple arguments', () => {
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

    expect(operationExpr.args).toHaveLength(3);
    expect(operationExpr.args[0]?.kind).toBe('col');
    expect(operationExpr.args[1]?.kind).toBe('param');
    expect(operationExpr.args[2]?.kind).toBe('literal');
  });

  it('defines OperationExpr in projection', () => {
    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        {
          alias: 'id',
          expr: { kind: 'col', table: 'user', column: 'id' },
        },
        {
          alias: 'distance',
          expr: {
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
          },
        },
      ],
    };

    expect(ast.project).toHaveLength(2);
    expect(ast.project[1]?.expr.kind).toBe('operation');
  });

  it('defines OperationExpr in where clause', () => {
    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'eq',
        left: {
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
        },
        right: { kind: 'param', index: 2, name: 'threshold' },
      },
    };

    expect(ast.where?.left.kind).toBe('operation');
  });

  it('defines OperationExpr in orderBy clause', () => {
    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      orderBy: [
        {
          expr: {
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
          },
          dir: 'asc',
        },
      ],
    };

    expect(ast.orderBy?.[0]?.expr.kind).toBe('operation');
  });
});
