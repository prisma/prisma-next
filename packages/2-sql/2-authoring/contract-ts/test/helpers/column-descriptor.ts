import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';

export function columnDescriptor<const CodecId extends string>(
  codecId: CodecId,
  nativeType?: string,
): ColumnTypeDescriptor<CodecId>;
export function columnDescriptor<
  const CodecId extends string,
  const TypeParams extends Record<string, unknown>,
>(
  codecId: CodecId,
  nativeType: string | undefined,
  typeParams: TypeParams,
): ColumnTypeDescriptor<CodecId> & { readonly typeParams: TypeParams };
export function columnDescriptor(
  codecId: string,
  nativeType?: string,
  typeParams?: Record<string, unknown>,
): ColumnTypeDescriptor {
  const derived = nativeType ?? codecId.match(/^[^/]+\/([^@]+)@/)?.[1] ?? codecId;
  return {
    codecId,
    nativeType: derived,
    ...(typeParams ? { typeParams } : {}),
  };
}
