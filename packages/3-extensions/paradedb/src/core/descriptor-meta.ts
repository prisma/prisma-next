import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import { LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import {
  buildOperation,
  type CodecExpression,
  type Expression,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import { paradedbIndexTypes } from '../types/index-types';
import { PARADEDB_EXTENSION_ID } from './constants';
import { ParadeDbProximityChain } from './proximity-chain';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT = 'pg/text@1' as const;
const BOOL = 'pg/bool@1' as const;
const FLOAT4 = 'pg/float4@1' as const;
const INT4 = 'pg/int4@1' as const;

// `@@@` accepts both text and structured query types on its RHS;
// `|||`/`&&&`/`===`/`###` are text-RHS-only.
// https://docs.paradedb.com/documentation/full-text/match
// https://docs.paradedb.com/documentation/full-text/term
// https://docs.paradedb.com/documentation/full-text/phrase
function matchOp<CT extends CodecTypesBase>(
  method: string,
  operator: '@@@' | '|||' | '&&&' | '===' | '###',
): SqlOperationDescriptor {
  return {
    method,
    self: { codecId: TEXT },
    impl: (
      self: CodecExpression<'pg/text@1', boolean, CT>,
      query: CodecExpression<'pg/text@1', boolean, CT>,
    ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> =>
      buildOperation({
        method,
        args: [toExpr(self, TEXT), toExpr(query, TEXT)],
        returns: { codecId: BOOL, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: `{{self}} ${operator} {{arg0}}`,
        },
      }),
  };
}

// PG rejects parameterized typmods, so the cast argument lowers to a literal.
// https://docs.paradedb.com/documentation/full-text/fuzzy
// https://docs.paradedb.com/documentation/sorting/boost
// https://docs.paradedb.com/documentation/full-text/phrase
function typmodCastOp<CT extends CodecTypesBase>(
  method: string,
  pdbType: 'fuzzy' | 'boost' | 'const' | 'slop',
  validate: (n: number) => string | null,
): SqlOperationDescriptor {
  return {
    method,
    self: { codecId: TEXT },
    impl: (
      self: CodecExpression<'pg/text@1', boolean, CT>,
      n: number,
    ): Expression<{ codecId: 'pg/text@1'; nullable: false }> => {
      const error = validate(n);
      if (error) throw new Error(`${method}: ${error}; got ${String(n)}`);
      return buildOperation({
        method,
        args: [toExpr(self, TEXT), LiteralExpr.of(n)],
        returns: { codecId: TEXT, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: `{{self}}::pdb.${pdbType}({{arg0}})`,
        },
      });
    },
  };
}

export function paradedbQueryOperations<
  CT extends CodecTypesBase,
>(): readonly SqlOperationDescriptor[] {
  return [
    matchOp('paradeDbMatch', '@@@'),
    matchOp('paradeDbMatchAny', '|||'),
    matchOp('paradeDbMatchAll', '&&&'),
    matchOp('paradeDbTerm', '==='),
    matchOp('paradeDbPhrase', '###'),
    {
      // https://docs.paradedb.com/documentation/sorting/score
      method: 'paradeDbScore',
      self: { codecId: INT4 },
      impl: (
        self: CodecExpression<'pg/int4@1', boolean, CT>,
      ): Expression<{ codecId: 'pg/float4@1'; nullable: false }> =>
        buildOperation({
          method: 'paradeDbScore',
          args: [toExpr(self, INT4)],
          returns: { codecId: FLOAT4, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'pdb.score({{self}})',
          },
        }),
    },
    typmodCastOp('paradeDbFuzzy', 'fuzzy', (n) =>
      Number.isInteger(n) && n >= 0 && n <= 2 ? null : 'distance must be an integer in [0, 2]',
    ),
    typmodCastOp('paradeDbBoost', 'boost', (n) =>
      Number.isInteger(n) && n >= -2048 && n <= 2048
        ? null
        : 'boost must be an integer in [-2048, 2048]',
    ),
    typmodCastOp('paradeDbConst', 'const', (n) =>
      Number.isInteger(n) ? null : 'value must be an integer',
    ),
    typmodCastOp('paradeDbSlop', 'slop', (n) =>
      Number.isInteger(n) && n >= 0 ? null : 'slop must be a non-negative integer',
    ),
    {
      // https://docs.paradedb.com/documentation/full-text/proximity
      method: 'paradeDbProximity',
      self: { codecId: TEXT },
      impl: (start: CodecExpression<'pg/text@1', boolean, CT>): ParadeDbProximityChain =>
        new ParadeDbProximityChain(start),
    },
  ];
}

export const paradedbPackMeta = {
  kind: 'extension',
  id: PARADEDB_EXTENSION_ID,
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'paradedb/bm25': true,
    },
  },
  indexTypes: paradedbIndexTypes,
  types: {
    queryOperationTypes: {
      import: {
        package: '@prisma-next/extension-paradedb/operation-types',
        named: 'QueryOperationTypes',
        alias: 'ParadeDbQueryOperationTypes',
      },
    },
  },
} as const;
