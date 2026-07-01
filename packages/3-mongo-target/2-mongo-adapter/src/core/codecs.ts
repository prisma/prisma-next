import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecDescriptor, CodecTrait } from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import {
  type MongoCodec,
  type MongoCodecRegistry,
  mongoCodec,
  newMongoCodecRegistry,
} from '@prisma-next/mongo-codec';
import { ObjectId } from 'mongodb';
import {
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
  MONGO_VECTOR_CODEC_ID,
} from './codec-ids';

export const mongoObjectIdCodec = mongoCodec({
  typeId: MONGO_OBJECTID_CODEC_ID,
  decode: (wire: ObjectId) => wire.toHexString(),
  encode: (value: string) => new ObjectId(value),
});

export const mongoStringCodec = mongoCodec({
  typeId: MONGO_STRING_CODEC_ID,
  decode: (wire: string) => wire,
  encode: (value: string) => value,
});

export const mongoDoubleCodec = mongoCodec({
  typeId: MONGO_DOUBLE_CODEC_ID,
  decode: (wire: number) => wire,
  encode: (value: number) => value,
});

export const mongoInt32Codec = mongoCodec({
  typeId: MONGO_INT32_CODEC_ID,
  decode: (wire: number) => wire,
  encode: (value: number) => value,
});

export const mongoBooleanCodec = mongoCodec({
  typeId: MONGO_BOOLEAN_CODEC_ID,
  decode: (wire: boolean) => wire,
  encode: (value: boolean) => value,
});

export const mongoDateCodec = mongoCodec({
  typeId: MONGO_DATE_CODEC_ID,
  decode: (wire: Date) => wire,
  encode: (value: Date) => value,
  encodeJson: (value: Date) => value.toISOString(),
  decodeJson: (json) => {
    if (typeof json !== 'string') throw new Error('expected ISO date string');
    return new Date(json);
  },
});

export const mongoVectorCodec = mongoCodec({
  typeId: MONGO_VECTOR_CODEC_ID,
  decode: (wire: readonly number[]) => wire,
  encode: (value: readonly number[]) => value,
});

/**
 * The canonical set of Mongo wire-type codecs.
 *
 * Single source of truth for both control- and runtime-plane adapter descriptors. Don't duplicate this list — import it.
 */
export const mongoStandardCodecs = [
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoBooleanCodec,
  mongoDateCodec,
  mongoVectorCodec,
] as const;

/**
 * Build a {@link CodecDescriptor} for a Mongo wire-type codec.
 *
 * Wraps an existing {@link MongoCodec} instance into a descriptor whose factory hands out the same shared codec. Mongo's full migration to descriptor-first authoring is tracked under TML-2324; for now the descriptor view is composed from the existing `mongoCodec()` outputs.
 */
/**
 * Renders a codec-encoded value as a TS literal. Valid only for identity codecs whose `encodeJson`
 * output equals their decoded output type (string, double, int32, boolean) — it renders the
 * encoded value directly. Used by the interim Mongo enum-field typing (removed by TML-2953).
 */
function renderPrimitiveLiteral(value: JsonValue): string | undefined {
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `'${escaped}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function descriptorFor<Id extends string>(
  codec: MongoCodec<Id, readonly CodecTrait[]>,
  metadata: {
    readonly traits: readonly CodecTrait[];
    readonly targetTypes: readonly string[];
    readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
    readonly renderValueType?: CodecDescriptor['renderValueType'];
  },
): CodecDescriptor {
  // The descriptor's `P` is structurally `Record<string, unknown>` for codecs that take params (Mongo `vector`); non-parameterized codecs ignore the slot. Cast through `unknown` to fit the `CodecDescriptor` slot's `(params: P) => …` typing without leaking a per-codec `P` into the heterogeneous descriptor list.
  const renderOutputType = metadata.renderOutputType as
    | CodecDescriptor['renderOutputType']
    | undefined;
  return {
    codecId: codec.id,
    traits: metadata.traits,
    targetTypes: metadata.targetTypes,
    paramsSchema: voidParamsSchema as CodecDescriptor['paramsSchema'],
    isParameterized: false,
    factory: (() => () => codec) as CodecDescriptor['factory'],
    ...(renderOutputType !== undefined ? { renderOutputType } : {}),
    ...(metadata.renderValueType !== undefined
      ? { renderValueType: metadata.renderValueType }
      : {}),
  };
}

const renderVectorOutputType = (typeParams: Record<string, unknown>): string | undefined => {
  const length = typeParams['length'];
  if (length === undefined) return undefined;
  if (
    typeof length !== 'number' ||
    !Number.isFinite(length) ||
    !Number.isInteger(length) ||
    length <= 0
  ) {
    throw new Error('renderOutputType: expected positive integer "length" for Vector');
  }
  return `Vector<${length}>`;
};

/**
 * Mongo wire-type codec descriptors. Static metadata for `traits`, `targetTypes`, and `renderOutputType` lives here (the descriptor shape) — `MongoCodec` itself is narrow and only carries the four conversion methods (TML-2357).
 */
export const mongoCodecDescriptors: ReadonlyArray<CodecDescriptor> = [
  descriptorFor(mongoObjectIdCodec, { traits: ['equality'], targetTypes: ['objectId'] }),
  descriptorFor(mongoStringCodec, {
    traits: ['equality', 'order', 'textual'],
    targetTypes: ['string'],
    renderValueType: renderPrimitiveLiteral,
  }),
  descriptorFor(mongoDoubleCodec, {
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['double'],
    renderValueType: renderPrimitiveLiteral,
  }),
  descriptorFor(mongoInt32Codec, {
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['int'],
    renderValueType: renderPrimitiveLiteral,
  }),
  descriptorFor(mongoBooleanCodec, {
    traits: ['equality', 'boolean'],
    targetTypes: ['bool'],
    renderValueType: renderPrimitiveLiteral,
  }),
  descriptorFor(mongoDateCodec, { traits: ['equality', 'order'], targetTypes: ['date'] }),
  descriptorFor(mongoVectorCodec, {
    traits: ['equality'],
    targetTypes: ['vector'],
    renderOutputType: renderVectorOutputType,
  }),
];

/**
 * Lookup descriptor metadata by codec id — used by tests and for descriptor-side reads of static metadata.
 */
export function mongoDescriptorById(codecId: string): CodecDescriptor | undefined {
  return mongoCodecDescriptors.find((d) => d.codecId === codecId);
}

/**
 * Build a {@link MongoCodecRegistry} preloaded with the standard Mongo wire-type codecs.
 *
 * Single point of truth for adapter-side codec construction: used by the legacy synchronous `createMongoAdapter()` factory and by the runtime adapter descriptor's `codecs()` getter. Userland code obtains a registry via the framework's execution-stack composition (see `createMongoExecutionContext`) instead of calling this directly.
 */
export function buildStandardCodecRegistry(): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  for (const codec of mongoStandardCodecs) {
    registry.register(codec);
  }
  return registry;
}
