/**
 * Class-based form of the pgvector extension codec (TML-2357 M0 Phase B4).
 *
 * Mirrors the Phase B2/B3 patterns (postgres/codecs-class.ts,
 * sqlite/codecs-class.ts) for the single `pg/vector@1` codec. Three
 * artifacts:
 *
 * 1. `PgVectorCodec` extends {@link CodecImpl} with the runtime
 *    encode/decode/encodeJson/decodeJson conversions inline. Conversions
 *    are simple enough (PostgreSQL `[1,2,3]` text format) that no shared
 *    helper module is warranted; the class body is the source of truth.
 * 2. `PgVectorDescriptor` extends {@link CodecDescriptorImpl} with the
 *    codec id, traits, target types, params schema (`{ length: number }`,
 *    validated against {@link VECTOR_MAX_DIM}), `meta` (postgres
 *    `nativeType: 'vector'`), and the emit-path `renderOutputType`
 *    producing `Vector<${length}>`.
 * 3. `pgVectorColumn(length)` per-codec column helper invoking
 *    `descriptor.factory({ length })` directly + passing the bare
 *    nativeType `'vector'` per F5's convention. The family-layer
 *    {@link expandNativeType} hook renders the parameterized form
 *    (`vector(1536)`) at emit/verify time from `nativeType` +
 *    `typeParams`.
 *
 * The legacy `mkCodec` / `defineCodec` exports in `codecs.ts` remain
 * during M0 Phase B for compatibility with downstream consumers; both
 * forms coexist until Phase C.
 *
 * Audit: `length` is parameter-stateless at the runtime level — the
 * encode/decode conversions don't thread the dimension into their
 * behaviour. `length` only informs the emit-path `renderOutputType`
 * and the bounds check in `paramsSchema`. The factory ignores params
 * and constructs a fresh codec from `this`.
 */

import { arktypeParamsSchema, type JsonValue } from '@prisma-next/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@prisma-next/framework-components/codec';
import type { ExtractCodecTypes } from '@prisma-next/sql-relational-core/ast';
import { type as arktype } from 'arktype';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './constants';

// ---------------------------------------------------------------------------
// Params schema + types.
// ---------------------------------------------------------------------------

const vectorParamsSchema = arktype({
  length: 'number',
}).narrow((params, ctx) => {
  const { length } = params;
  if (!Number.isInteger(length)) {
    return ctx.mustBe('an integer');
  }
  if (length < 1 || length > VECTOR_MAX_DIM) {
    return ctx.mustBe(`in the range [1, ${VECTOR_MAX_DIM}]`);
  }
  return true;
});

type VectorParams = { readonly length: number };

const PG_VECTOR_META = { db: { sql: { postgres: { nativeType: 'vector' } } } } as const;

// ---------------------------------------------------------------------------
// pg/vector@1 — length-parameterized, JSON-safe (number[]). Wire is the
// PostgreSQL `[v1,v2,...]` text format.
// ---------------------------------------------------------------------------

export class PgVectorCodec extends CodecImpl<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  number[]
> {
  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    if (typeof wire !== 'string') {
      throw new Error('Vector wire value must be a string');
    }
    if (!wire.startsWith('[') || !wire.endsWith(']')) {
      throw new Error(`Invalid vector format: expected "[...]", got "${wire}"`);
    }
    const content = wire.slice(1, -1).trim();
    if (content === '') {
      return [];
    }
    return content.split(',').map((v) => {
      const num = Number.parseFloat(v.trim());
      if (Number.isNaN(num)) {
        throw new Error(`Invalid vector value: "${v}" is not a number`);
      }
      return num;
    });
  }

  encodeJson(value: number[]): JsonValue {
    return value;
  }

  decodeJson(json: JsonValue): number[] {
    return json as number[];
  }
}

export class PgVectorDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly meta = PG_VECTOR_META;
  override readonly paramsSchema = arktypeParamsSchema<VectorParams>(vectorParamsSchema);
  override renderOutputType(params: VectorParams): string {
    return `Vector<${params.length}>`;
  }
  override factory(_params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this);
  }
}

export const pgVectorDescriptorClass = new PgVectorDescriptor();

/**
 * Per-codec column helper for `pg/vector@1`. Generic over `N extends number`
 * so the column site preserves the dimension literal in `typeParams`
 * (e.g. `pgVectorColumn(1536)` packs `typeParams: { length: 1536 }`).
 *
 * Passes the bare `nativeType: 'vector'`; the family-layer
 * `expandNativeType` hook renders the parameterized form (`vector(1536)`)
 * at emit/verify time from `nativeType` + `typeParams`. This matches the
 * F5 convention validated by the reviewer's M0 R2 verdict.
 */
export const pgVectorColumn = <N extends number>(length: N) =>
  column(
    pgVectorDescriptorClass.factory({ length }),
    pgVectorDescriptorClass.codecId,
    { length },
    'vector',
  );

pgVectorColumn satisfies ColumnHelperFor<PgVectorDescriptor>;
pgVectorColumn satisfies ColumnHelperForStrict<PgVectorDescriptor>;

// ---------------------------------------------------------------------------
// Class-form descriptor map (TML-2357 M0 Phase B5/C). Single entry today:
// `pg/vector@1`. Keyed by scalar name so {@link CodecTypes} resolves through
// `ExtractCodecTypes`, preserving the input/output/traits shape
// downstream consumers (`descriptor-meta.ts`, `exports/codec-types.ts`)
// rely on. The list view (`codecDescriptorClassList`) iterates these in
// the emit-stable order via `Object.values`.
// ---------------------------------------------------------------------------

const codecDescriptorMap = {
  vector: pgVectorDescriptorClass,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptorClassList: readonly AnyCodecDescriptor[] =
  Object.values(codecDescriptorMap);
