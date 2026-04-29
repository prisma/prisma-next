/**
 * pgvector SQL query operations: cosineDistance and cosineSimilarity. These
 * lower to pgvector's `<=>` operator (cosine distance); cosine similarity is
 * `1 - cosineDistance`.
 *
 * The factory is generic over the contract's codec-types map per ADR 204 so
 * authored signatures specialize to the contract at composition time.
 */

import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import {
  buildOperation,
  type CodecExpression,
  type Expression,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import { VECTOR_CODEC_ID } from './vector-codec';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

export function pgvectorQueryOperations<
  CT extends CodecTypesBase,
>(): readonly SqlOperationDescriptor[] {
  return [
    {
      method: 'cosineDistance',
      self: { codecId: VECTOR_CODEC_ID },
      impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ): Expression<{ codecId: 'pg/float8@1'; nullable: false }> =>
        buildOperation({
          method: 'cosineDistance',
          args: [toExpr(self, VECTOR_CODEC_ID), toExpr(other, VECTOR_CODEC_ID)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '{{self}} <=> {{arg0}}',
          },
        }),
    },
    {
      method: 'cosineSimilarity',
      self: { codecId: VECTOR_CODEC_ID },
      impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ): Expression<{ codecId: 'pg/float8@1'; nullable: false }> =>
        buildOperation({
          method: 'cosineSimilarity',
          args: [toExpr(self, VECTOR_CODEC_ID), toExpr(other, VECTOR_CODEC_ID)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '1 - ({{self}} <=> {{arg0}})',
          },
        }),
    },
  ];
}
