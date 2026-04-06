import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual' | 'vector';

export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  encode?(value: TJs): TWire;
  decode(wire: TWire): TJs;
  encodeJson(value: TJs): JsonValue;
  decodeJson(json: JsonValue): TJs;
}

export interface CodecLookup {
  get(id: string): Codec | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
};
