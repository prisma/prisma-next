import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';

export type MongoCodecTrait = CodecTrait;

/**
 * Mongo codec interface — extends the framework base.
 *
 * `renderOutputType` is a temporary M1 holding place on the Mongo `Codec` extension
 * while production codecs continue to author it inline; the long-term home is
 * `ParameterizedCodecDescriptor.renderOutputType` (codec-model-unification project,
 * locked at M1; production codecs migrate in M4).
 */
export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TJs = unknown,
> extends BaseCodec<Id, TTraits, TWire, TJs> {
  readonly traits: TTraits;
  readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}

export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TJs = unknown,
>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  traits?: TTraits;
  encode: (value: TJs) => TWire;
  decode: (wire: TWire) => TJs;
  encodeJson?: (value: TJs) => JsonValue;
  decodeJson?: (json: JsonValue) => TJs;
  renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}): MongoCodec<Id, TTraits, TWire, TJs> {
  const traits = config.traits
    ? (Object.freeze([...config.traits]) as TTraits)
    : (Object.freeze([] as const) as unknown as TTraits);
  const identity = (v: unknown) => v;
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    traits,
    decode: config.decode,
    encode: config.encode,
    encodeJson: (config.encodeJson ?? identity) as (value: TJs) => JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (json: JsonValue) => TJs,
    ...(config.renderOutputType ? { renderOutputType: config.renderOutputType } : {}),
  };
}

export type MongoCodecJsType<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TJs> ? TJs : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
