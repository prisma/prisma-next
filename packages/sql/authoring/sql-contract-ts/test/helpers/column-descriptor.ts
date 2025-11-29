import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';

export function columnDescriptor(codecId: string, nativeType?: string): ColumnTypeDescriptor {
  const derived = nativeType ?? codecId.match(/^[^/]+\/([^@]+)@/)?.[1] ?? codecId;
  return { codecId, nativeType: derived };
}
