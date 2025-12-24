/**
 * Test utilities for working with extension packs.
 * These functions are pack-based versions of the descriptor-based assembly functions,
 * designed for use in tests and integration tests.
 */
export {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '../core/assembly';
