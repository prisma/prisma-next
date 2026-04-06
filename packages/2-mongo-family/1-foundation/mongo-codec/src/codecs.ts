import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';

export type MongoCodecTrait = CodecTrait;

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
  encodeJson?: (value: TJs) => import('@prisma-next/contract/types').JsonValue;
  decodeJson?: (json: import('@prisma-next/contract/types').JsonValue) => TJs;
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
    encodeJson: (config.encodeJson ?? identity) as (
      value: TJs,
    ) => import('@prisma-next/contract/types').JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (
      json: import('@prisma-next/contract/types').JsonValue,
    ) => TJs,
  };
}

export type MongoCodecJsType<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TJs> ? TJs : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
