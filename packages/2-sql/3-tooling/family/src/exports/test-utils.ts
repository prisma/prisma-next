/**
 * Test utilities for working with component descriptors.
 * These functions operate on descriptors directly, used in tests and integration tests.
 */
export {
  extractCodecTypeImports,
  extractComponentIds,
  extractOperationTypeImports,
  extractQueryOperationTypeImports,
} from '@prisma-next/contract/assembly';
export { assembleOperationRegistry } from '../core/assembly';
