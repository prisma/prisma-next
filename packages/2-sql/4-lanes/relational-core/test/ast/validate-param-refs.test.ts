import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '../../src/ast/types';
import { validateParamRefRefs } from '../../src/ast/validate-param-refs';
import type { CodecDescriptorRegistry } from '../../src/query-lane-context';

const PARAMETERIZED_IDS = new Set(['sql/varchar@1', 'pgvector/vector@1']);

const stubDescriptor = (codecId: string): CodecDescriptor<unknown> =>
  ({
    codecId,
    isParameterized: PARAMETERIZED_IDS.has(codecId),
  }) as unknown as CodecDescriptor<unknown>;

const registry: CodecDescriptorRegistry = {
  descriptorFor: (codecId) => stubDescriptor(codecId),
  *values() {
    for (const id of PARAMETERIZED_IDS) yield stubDescriptor(id);
  },
  byTargetType: () => Object.freeze([]),
};

function selectWithWhere(...where: Parameters<typeof AndExpr.of>[0]): SelectAst {
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(AndExpr.of(where));
}

describe('validateParamRefRefs', () => {
  it('passes when refs are present on a parameterized-codec ParamRef', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codecId: 'sql/varchar@1',
      refs: { table: 'user', column: 'email' },
    });
    const ast = selectWithWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ref));

    expect(() => validateParamRefRefs(ast, registry)).not.toThrow();
  });

  it('passes when codecId is a non-parameterized id and refs are absent', () => {
    const ref = ParamRef.of(42, { name: 'p1', codecId: 'sql/int@1' });
    const ast = selectWithWhere(BinaryExpr.eq(ColumnRef.of('user', 'age'), ref));

    expect(() => validateParamRefRefs(ast, registry)).not.toThrow();
  });

  it('passes when codecId is undefined (untyped ParamRef)', () => {
    const ref = ParamRef.of('whatever');
    const ast = selectWithWhere(BinaryExpr.eq(ColumnRef.of('user', 'name'), ref));

    expect(() => validateParamRefRefs(ast, registry)).not.toThrow();
  });

  it('throws RUNTIME.PARAM_REF_REFS_REQUIRED when a parameterized-codec ParamRef lacks refs', () => {
    const ref = ParamRef.of('hello', { name: 'p1', codecId: 'sql/varchar@1' });
    const ast = selectWithWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ref));

    expect(() => validateParamRefRefs(ast, registry)).toThrowError(/sql\/varchar@1/);
    try {
      validateParamRefRefs(ast, registry);
    } catch (err) {
      const error = err as {
        code: string;
        message: string;
        details?: { codecId?: string; paramName?: string };
      };
      expect(error.code).toBe('RUNTIME.PARAM_REF_REFS_REQUIRED');
      expect(error.message).toContain("ParamRef 'p1'");
      expect(error.message).toContain('sql/varchar@1');
      expect(error.details?.codecId).toBe('sql/varchar@1');
      expect(error.details?.paramName).toBe('p1');
    }
  });

  it("uses '<anonymous>' label when ParamRef has no name", () => {
    const ref = ParamRef.of([1, 2], { codecId: 'pgvector/vector@1' });
    const ast = selectWithWhere(BinaryExpr.eq(ColumnRef.of('post', 'embedding'), ref));

    expect(() => validateParamRefRefs(ast, registry)).toThrowError(/<anonymous>/);
  });
});
