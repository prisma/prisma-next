/**
 * Vector codec implementation for pgvector extension.
 *
 * Provides encoding/decoding for the `vector` PostgreSQL type.
 * Wire format is a string like `[1,2,3]` (PostgreSQL vector text format).
 */

import {
  type AnyCodecDescriptor,
  type Codec,
  type DescriptorCodecInput,
  defineCodec,
  type ExtractDescriptorCodecTypes,
} from '@prisma-next/sql-relational-core/ast';
import { type as arktype } from 'arktype';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './constants';

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

export const pgVectorDescriptor = defineCodec<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  number[],
  { readonly length: number }
>({
  codecId: VECTOR_CODEC_ID,
  targetTypes: ['vector'],
  traits: ['equality'],
  paramsSchema: vectorParamsSchema,
  renderOutputType: (params) => `Vector<${params.length}>`,
  encode: (value) => {
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    return `[${value.join(',')}]`;
  },
  decode: (wire) => {
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
  },
  meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
});

// ---------------------------------------------------------------------------
// Scalar-keyed views derived from the descriptor source-of-truth.
// `byScalar[k].codec` materializes the runtime `Codec` instance via
// the descriptor's `factory`; encode/decode do not depend on params, so a
// shared (no-params) materialization is sufficient for the registry-style
// runtime path.
// ---------------------------------------------------------------------------

const pgvectorDescriptors = {
  vector: pgVectorDescriptor,
} as const;

type PgVectorDescriptors = typeof pgvectorDescriptors;

function materializeDescriptorCodec(d: AnyCodecDescriptor): Codec {
  return d.factory(undefined as never)({
    name: `<shared:${d.codecId}>`,
  }) as Codec;
}

type PgVectorByScalar = {
  readonly [K in keyof PgVectorDescriptors]: {
    readonly typeId: PgVectorDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly codec: Codec;
    readonly input: DescriptorCodecInput<PgVectorDescriptors[K]>;
    readonly output: DescriptorCodecInput<PgVectorDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<PgVectorDescriptors[K]>;
  };
};

type PgVectorCodecDescriptorDefinitions = {
  readonly [K in keyof PgVectorDescriptors]: {
    readonly codecId: PgVectorDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly descriptor: PgVectorDescriptors[K];
    readonly input: DescriptorCodecInput<PgVectorDescriptors[K]>;
    readonly output: DescriptorCodecInput<PgVectorDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<PgVectorDescriptors[K]>;
  };
};

type PgVectorDataTypes = {
  readonly [K in keyof PgVectorDescriptors]: PgVectorDescriptors[K]['codecId'];
};

function buildPgVectorCodecMaps(): {
  readonly byScalar: PgVectorByScalar;
  readonly descriptorDefinitions: PgVectorCodecDescriptorDefinitions;
  readonly dataTypes: PgVectorDataTypes;
  readonly descriptorList: ReadonlyArray<AnyCodecDescriptor>;
} {
  const byScalar: Record<string, unknown> = {};
  const descriptorDefinitions: Record<string, unknown> = {};
  const dataTypes: Record<string, string> = {};
  const descriptorList: AnyCodecDescriptor[] = [];

  for (const [scalar, descriptor] of Object.entries(pgvectorDescriptors)) {
    const d = descriptor as AnyCodecDescriptor;
    const codec = materializeDescriptorCodec(d);
    byScalar[scalar] = {
      typeId: d.codecId,
      scalar,
      codec,
      input: undefined,
      output: undefined,
      jsType: undefined,
    };
    descriptorDefinitions[scalar] = {
      codecId: d.codecId,
      scalar,
      descriptor: d,
      input: undefined,
      output: undefined,
      jsType: undefined,
    };
    dataTypes[scalar] = d.codecId;
    descriptorList.push(d);
  }

  return {
    byScalar: byScalar as unknown as PgVectorByScalar,
    descriptorDefinitions: descriptorDefinitions as unknown as PgVectorCodecDescriptorDefinitions,
    dataTypes: dataTypes as unknown as PgVectorDataTypes,
    descriptorList,
  };
}

const pgvectorCodecMaps = buildPgVectorCodecMaps();

export const byScalar: PgVectorByScalar = pgvectorCodecMaps.byScalar;
export const dataTypes: PgVectorDataTypes = pgvectorCodecMaps.dataTypes;
export type CodecTypes = ExtractDescriptorCodecTypes<PgVectorDescriptors>;

/**
 * Descriptor view of the pgvector codecs, keyed by scalar name. Mirrors
 * {@link byScalar} on the descriptor side (TML-2357 T2.5).
 */
export const codecDescriptorDefinitions: PgVectorCodecDescriptorDefinitions =
  pgvectorCodecMaps.descriptorDefinitions;

/**
 * Flat array of every pgvector codec descriptor — ready to feed into a
 * contributor's unified `codecs:` slot.
 */
export const codecDescriptorList: ReadonlyArray<AnyCodecDescriptor> =
  pgvectorCodecMaps.descriptorList;
