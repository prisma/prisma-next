/**
 * pgvector extension codec (TML-2357).
 *
 * Mirrors the patterns in `postgres/codecs-class.ts` and `sqlite/codecs-class.ts` for the single `pg/vector@1` codec. Three artifacts:
 *
 * 1. `PgVectorCodec` extends {@link CodecImpl} with the runtime encode/decode/encodeJson/decodeJson conversions inline. Conversions are simple enough (PostgreSQL `[1,2,3]` text format) that no shared helper module is warranted; the class body is the source of truth. 2. `PgVectorDescriptor` extends {@link CodecDescriptorImpl} with the codec id, traits, target types, params schema (`{ length: number }`, validated against
 * {@link VECTOR_MAX_DIM}), `meta` (postgres `nativeType: 'vector'`), and the emit-path `renderOutputType` producing `Vector<${length}>`. 3. `pgVectorColumn(length)` per-codec column helper invoking `descriptor.factory({ length })` directly + passing the bare nativeType `'vector'` per F5's convention. The family-layer {@link expandNativeType} hook renders the parameterized form (`vector(1536)`) at emit/verify time from
 * `nativeType` + `typeParams`.
 *
 * After TML-2357 this is the canonical source of pgvector codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers retired with the deletion sweep.
 *
 * Audit: `length` threads into the runtime codec via the constructor so encode/decode/encodeJson/decodeJson can enforce the declared dimension at every ingress path. Without this, `vector(3)` and `vector(1536)` would produce codecs with identical behaviour and a dimension-mismatched value would round-trip undetected — that's the dispatch-correctness symptom F22 / F26 also touch (cluster closure).
 */

import type { JsonValue } from '@prisma-next/contract/types';
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
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './constants';

// ---------------------------------------------------------------------------Params schema + types. ---------------------------------------------------------------------------

type VectorParams = { readonly length: number };

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
}) satisfies StandardSchemaV1<VectorParams>;

const PG_VECTOR_META = { db: { sql: { postgres: { nativeType: 'vector' } } } } as const;

// ---------------------------------------------------------------------------pg/vector@1 — length-parameterized, JSON-safe (number[]). Wire is the PostgreSQL `[v1,v2,...]` text format. ---------------------------------------------------------------------------

export class PgVectorCodec extends CodecImpl<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  number[]
> {
  readonly length: number | undefined;

  constructor(descriptor: AnyCodecDescriptor, length: number | undefined) {
    super(descriptor);
    this.length = length;
  }

  assertVector(value: unknown): asserts value is number[] {
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    if (this.length !== undefined && value.length !== this.length) {
      throw new Error(`Vector length mismatch: expected ${this.length}, got ${value.length}`);
    }
  }

  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value);
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
    const parsed =
      content === ''
        ? []
        : content.split(',').map((v) => {
            const num = Number.parseFloat(v.trim());
            if (Number.isNaN(num)) {
              throw new Error(`Invalid vector value: "${v}" is not a number`);
            }
            return num;
          });
    this.assertVector(parsed);
    return parsed;
  }

  encodeJson(value: number[]): JsonValue {
    this.assertVector(value);
    return value;
  }

  decodeJson(json: JsonValue): number[] {
    this.assertVector(json);
    return json;
  }
}

export class PgVectorDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly meta = PG_VECTOR_META;
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = vectorParamsSchema;
  override renderOutputType(params: VectorParams): string {
    return `Vector<${params.length}>`;
  }
  /**
   * The runtime calls `factory(undefined)(ctx)` to materialize a representative codec for parameterized descriptors that ship a no-params column variant (here, `vectorColumn` vs `vector(N)`). The runtime cast widens `params` to `unknown`, so guarding with an optional read keeps the typed call site (`factory({ length })`) strict while still producing a length-agnostic codec for representative use. Encode/decode for an undimensioned column run through this representative; the wire format `[v1,v2,...]` is dimension-independent.
   */
  override factory(params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this, (params as VectorParams | undefined)?.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

/**
 * Per-codec column helper for `pg/vector@1`. Generic over `N extends number` so the column site preserves the dimension literal in `typeParams` (e.g. `pgVectorColumn(1536)` packs `typeParams: { length: 1536 }`).
 *
 * Passes the bare `nativeType: 'vector'`; the family-layer `expandNativeType` hook renders the parameterized form (`vector(1536)`) at emit/verify time from `nativeType` + `typeParams`. This matches the F5 convention validated by the reviewer's M0 R2 verdict.
 */
export const pgVectorColumn = <N extends number>(length: N) =>
  column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length }, 'vector');

pgVectorColumn satisfies ColumnHelperFor<PgVectorDescriptor>;
pgVectorColumn satisfies ColumnHelperForStrict<PgVectorDescriptor>;

// ---------------------------------------------------------------------------Internal descriptor registration. Single entry today: `pg/vector@1`. The codec-id-keyed type-level map drives `ExtractCodecTypes` to derive `CodecTypes` (input/output/traits projection used by downstream consumers). The list view feeds the package-scoped `pgvectorCodecRegistry` exposed via `core/registry.ts`.
// ---------------------------------------------------------------------------

const codecDescriptorMap = {
  vector: pgVectorDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors: readonly AnyCodecDescriptor[] = Object.values(codecDescriptorMap);
