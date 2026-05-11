import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';

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
