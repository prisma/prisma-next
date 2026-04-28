import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';

export type MongoCodecTrait = CodecTrait;

/**
 * Mongo codec interface — extends the framework base.
 *
 * Parameterization slots have all moved to `ParameterizedCodecDescriptor`
 * (see `@prisma-next/framework-components/codec`). The transitional
 * `renderOutputType` hook held here through M1-M3 was removed in M4 cleanup
 * F01: `ParameterizedCodecDescriptor.renderOutputType` is now the sole emit-
 * path source of truth.
 */
export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TJs = unknown,
> extends BaseCodec<Id, TTraits, TWire, TJs> {
  readonly traits: TTraits;
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
  };
}

export type MongoCodecJsType<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TJs> ? TJs : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
