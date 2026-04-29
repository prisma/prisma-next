/**
 * Higher-order codec factory for the Mongo `mongo/vector@1` codec.
 *
 * Pack-author surface: users write `vector(1536)` at a column site. The factory
 * returns a `ColumnTypeDescriptor` carrying both the data part (`codecId`,
 * `nativeType`, `typeParams`) AND a curried higher-order codec factory in the
 * `type` slot so the no-emit `FieldOutputType` resolver derives the column's
 * resolved JS type as `Vector<N>`. See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import { type as arktype } from 'arktype';
import { MONGO_VECTOR_CODEC_ID } from '../core/codec-ids';
import type { Vector } from '../exports/codec-types';

export type MongoVectorCodec<N extends number = number> = Codec<
  typeof MONGO_VECTOR_CODEC_ID,
  readonly ['equality'],
  readonly number[],
  Vector<N>
>;

export function mongoVectorCodecForLength<N extends number>(
  _length: N,
): (ctx: Ctx) => MongoVectorCodec<N> {
  return (_ctx) => ({
    id: MONGO_VECTOR_CODEC_ID,
    targetTypes: ['vector'] as const,
    traits: ['equality'] as const,
    encode: (value: Vector<N>) => value,
    decode: (wire: readonly number[]) => wire as Vector<N>,
    encodeJson: (value: Vector<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Vector<N>,
  });
}

/**
 * Curried higher-order codec factory for dimensioned mongo vector columns.
 * The user-facing call site is `vector(1536)`; the column descriptor's `type`
 * slot carries the curried factory so the no-emit `FieldOutputType` resolves
 * the column to `Vector<1536>` (literal preserved).
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof MONGO_VECTOR_CODEC_ID;
  readonly nativeType: 'vector';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => MongoVectorCodec<N>;
} {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`mongo: vector dimension must be a positive integer, got ${length}`);
  }
  return {
    codecId: MONGO_VECTOR_CODEC_ID,
    nativeType: 'vector',
    typeParams: { length },
    type: mongoVectorCodecForLength(length),
  } as const;
}

const vectorParamsSchema = arktype({
  length: 'number.integer > 0',
});

export const mongoVectorParameterizedCodec: ParameterizedCodecDescriptor<{
  readonly length: number;
}> = {
  codecId: MONGO_VECTOR_CODEC_ID,
  traits: ['equality'] as const,
  targetTypes: ['vector'] as const,
  paramsSchema: vectorParamsSchema,
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => mongoVectorCodecForLength(length),
};
