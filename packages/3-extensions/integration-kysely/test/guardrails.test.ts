import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  KYSELY_TRANSFORM_ERROR_CODES,
  KyselyTransformError,
  runGuardrails,
} from '@prisma-next/sql-kysely-lane';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

function selectWithJoin(selections: unknown[], where?: unknown) {
  return {
    kind: 'SelectQueryNode',
    from: {
      kind: 'FromNode',
      froms: [
        {
          kind: 'TableNode',
          table: { kind: 'IdentifierNode', name: 'user' },
        },
      ],
    },
    selections,
    joins: [
      {
        kind: 'JoinNode',
        joinType: 'LeftJoinNode',
        table: {
          kind: 'TableNode',
          table: { kind: 'IdentifierNode', name: 'post' },
        },
        on: {
          kind: 'OnNode',
          node: {
            kind: 'BinaryOperationNode',
            left: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
            operator: { kind: 'OperatorNode', operator: '=' },
            right: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'userId' },
                table: { kind: 'IdentifierNode', name: 'post' },
              },
            },
          },
        },
      },
    ],
    ...ifDefined('where', where != null ? { kind: 'WhereNode', node: where } : undefined),
  };
}

describe('runGuardrails', () => {
  describe('qualified-ref check', () => {
    it('rejects unqualified column ref in multi-table selections', () => {
      const query = selectWithJoin([
        {
          kind: 'SelectionNode',
          selection: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
            },
          },
        },
      ]);

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect(KyselyTransformError.is(e)).toBe(true);
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('rejects unqualified column ref in multi-table where', () => {
      const query = selectWithJoin(
        [
          {
            kind: 'SelectAllNode',
            reference: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
          },
        ],
        {
          kind: 'BinaryOperationNode',
          left: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
            },
          },
          operator: { kind: 'OperatorNode', operator: '=' },
          right: { kind: 'ValueNode', value: 1 },
        },
      );

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('rejects unqualified column ref in multi-table orderBy', () => {
      const query = selectWithJoin([
        {
          kind: 'SelectAllNode',
          reference: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
        },
      ]);
      (query as Record<string, unknown>)['orderBy'] = {
        kind: 'OrderByNode',
        items: [
          {
            kind: 'OrderByItemNode',
            orderBy: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'email' },
              },
            },
            direction: 'asc',
          },
        ],
      };

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('rejects IdentifierNode column ref in multi-table scope (regression: getTableName fallback bug)', () => {
      const query = selectWithJoin([
        {
          kind: 'SelectionNode',
          selection: {
            kind: 'ReferenceNode',
            column: { kind: 'IdentifierNode', name: 'id' },
          },
        },
      ]);

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect(KyselyTransformError.is(e)).toBe(true);
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('allows qualified column refs in multi-table scope', () => {
      const query = selectWithJoin([
        {
          kind: 'SelectionNode',
          selection: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          },
        },
      ]);

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });

    it('allows unqualified refs in single-table scope', () => {
      const query = {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [
            {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          ],
        },
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
              },
            },
          },
        ],
      };

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });

    it('rejects unqualified ref in multi-FROM scope (froms.length > 1)', () => {
      const query = {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [
            { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
            { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'post' } },
          ],
        },
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
              },
            },
          },
        ],
      };

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });
  });

  describe('ambiguous selectAll check', () => {
    it('rejects selectAll without table reference in multi-table scope', () => {
      const query = selectWithJoin([{ kind: 'SelectAllNode' }]);

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (e) {
        expect(KyselyTransformError.is(e)).toBe(true);
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
        );
      }
    });

    it('allows selectAll with explicit table in multi-table scope', () => {
      const query = selectWithJoin([
        {
          kind: 'SelectAllNode',
          reference: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
        },
      ]);

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });

    it('allows selectAll in single-table scope', () => {
      const query = {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [
            {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          ],
        },
        selections: [{ kind: 'SelectAllNode' }],
      };

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });
  });

  describe('non-select queries', () => {
    it('passes through InsertQueryNode without guardrail checks', () => {
      const query = {
        kind: 'InsertQueryNode',
        into: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
        values: { kind: 'ValuesNode', values: [] },
      };

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });

    it('passes through UpdateQueryNode without guardrail checks', () => {
      const query = {
        kind: 'UpdateQueryNode',
        table: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
        updates: [],
      };

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });

    it('passes through DeleteQueryNode without guardrail checks', () => {
      const query = {
        kind: 'DeleteQueryNode',
        from: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
      };

      expect(() => runGuardrails(contract, query)).not.toThrow();
    });
  });
});
