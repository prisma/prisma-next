/**
 * Column type descriptors for sqlite-vector extension.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import { VECTOR_CODEC_ID } from '../core/constants';

/**
 * Static vector column descriptor without dimension.
 *
 * SQLite stores vectors as JSON text.
 */
export const vectorColumn = {
  codecId: VECTOR_CODEC_ID,
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;
