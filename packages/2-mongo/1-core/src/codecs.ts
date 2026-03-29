export interface MongoCodec<Id extends string = string, TWire = unknown, TJs = unknown> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  decode(wire: TWire): TJs;
  encode?(value: TJs): TWire;
}

export function mongoCodec<Id extends string, TWire, TJs>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  encode: (value: TJs) => TWire;
  decode: (wire: TWire) => TJs;
}): MongoCodec<Id, TWire, TJs> {
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    decode: config.decode,
    encode: config.encode,
  };
}

export type MongoCodecInput<T> = T extends MongoCodec<string, unknown, infer TJs> ? TJs : never;
export type MongoCodecOutput<T> = T extends MongoCodec<string, unknown, infer TJs> ? TJs : never;
