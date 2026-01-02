/**
 * Test utilities for framework components.
 * Re-exports from integration test utilities to avoid fragile cross-package relative imports.
 */
export {
  getSqlDescriptorBundle,
  pgvectorExtensionDescriptor,
  type SqlDescriptorBundle,
} from '../../../../test/integration/utils/framework-components';
