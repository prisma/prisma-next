/**
 * Test utilities for working with component descriptors.
 * These functions operate on descriptors directly, used in tests and integration tests.
 */
export {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../core/assembly.ts';
export { convertOperationManifest } from '../core/instance.ts';
