/**
 * Column type descriptors for pgvector extension.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';

export const vectorColumn: ColumnTypeDescriptor = {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
} as const;
