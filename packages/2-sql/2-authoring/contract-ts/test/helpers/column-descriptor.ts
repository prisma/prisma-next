import type { CodecTrait, ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';

export function columnDescriptor<const TCodecId extends string = string>(
  codecId: TCodecId,
  nativeType?: string,
  typeParams?: Record<string, unknown>,
): ColumnTypeDescriptor & { readonly codecId: TCodecId } {
  const derived = nativeType ?? codecId.match(/^[^/]+\/([^@]+)@/)?.[1] ?? codecId;
  return {
    codecId,
    nativeType: derived,
    ...(typeParams ? { typeParams } : {}),
  };
}

/**
 * Test helper that produces a descriptor carrying a literal trait tuple at
 * the type level. The TS DSL reads `descriptor.traits` to drive trait gating
 * (e.g. `.default(autoincrement())` is admitted only when traits include
 * `'autoincrement'`). Production column helpers will surface traits the
 * same way once their packagers are updated; the test helper short-circuits
 * to that shape directly.
 */
export function columnDescriptorWithTraits<
  const TCodecId extends string,
  const TTraits extends readonly CodecTrait[],
>(
  codecId: TCodecId,
  traits: TTraits,
  nativeType?: string,
  typeParams?: Record<string, unknown>,
): ColumnTypeDescriptor & {
  readonly codecId: TCodecId;
  readonly traits: TTraits;
} {
  const derived = nativeType ?? codecId.match(/^[^/]+\/([^@]+)@/)?.[1] ?? codecId;
  return {
    codecId,
    nativeType: derived,
    traits,
    ...(typeParams ? { typeParams } : {}),
  };
}
