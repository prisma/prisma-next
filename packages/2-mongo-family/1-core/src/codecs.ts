export type MongoCodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual' | 'vector';

export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  decode(wire: TWire): TJs;
  encode?(value: TJs): TWire;
}

export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[],
  TWire,
  TJs,
>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  traits?: TTraits;
  encode: (value: TJs) => TWire;
  decode: (wire: TWire) => TJs;
}): MongoCodec<Id, TTraits, TWire, TJs> {
  const result: MongoCodec<Id, TTraits, TWire, TJs> = {
    id: config.typeId,
    targetTypes: config.targetTypes,
    decode: config.decode,
    encode: config.encode,
  };
  if (config.traits) {
    (result as { traits: TTraits }).traits = Object.freeze([...config.traits]) as TTraits;
  }
  return result;
}

export type MongoCodecJsType<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TJs> ? TJs : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
