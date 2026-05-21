/**
 * Synthetic-codec test helper for the `.default(value)` type extractor.
 *
 * The DSL's {@link import('../../src/contract-dsl').CodecInputForDescriptor}
 * extractor reads a codec's `TInput` off the field descriptor's
 * `codecFactory` slot — the shape produced by the framework `column()`
 * packager. Production tests already exercise that path via real codec
 * packs; the synthetic helper here lets type-level tests probe the
 * extractor with arbitrary `TInput` shapes (branded types, custom
 * classes, etc.) without depending on production codecs.
 *
 * The helper returns a descriptor compatible with `FieldDescriptorShape`
 * plus a `codecFactory` slot whose return type carries the configured
 * `TInput`. The factory is never invoked at runtime in type-level tests;
 * the helper exists purely to thread `TInput` into the descriptor's
 * static type.
 */
import type {
  Codec,
  CodecCallContext,
  CodecInstanceContext,
  CodecTrait,
  ColumnTypeDescriptor,
} from '@prisma-next/framework-components/codec';

export type SyntheticCodecDescriptor<
  TCodecId extends string,
  TTraits extends readonly CodecTrait[],
  TInput,
> = ColumnTypeDescriptor & {
  readonly codecId: TCodecId;
  readonly traits: TTraits;
  readonly codecFactory: (ctx: CodecInstanceContext) => Codec<TCodecId, TTraits, unknown, TInput>;
};

export function syntheticCodecDescriptor<
  const TCodecId extends string,
  const TTraits extends readonly CodecTrait[],
  TInput,
>(
  codecId: TCodecId,
  traits: TTraits,
  nativeType?: string,
): SyntheticCodecDescriptor<TCodecId, TTraits, TInput> {
  const derived = nativeType ?? codecId.match(/^[^/]+\/([^@]+)@/)?.[1] ?? codecId;
  return {
    codecId,
    nativeType: derived,
    traits,
    codecFactory: (): Codec<TCodecId, TTraits, unknown, TInput> => ({
      id: codecId,
      encode: async (_value: TInput, _ctx: CodecCallContext) => undefined,
      decode: async (_wire: unknown, _ctx: CodecCallContext) => undefined as TInput,
      encodeJson: () => null,
      decodeJson: () => undefined as TInput,
    }),
  };
}
