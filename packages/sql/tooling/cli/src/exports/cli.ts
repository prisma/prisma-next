import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/cli/config-types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import {
  assembleOperationRegistryFromDescriptors,
  extractCodecTypeImportsFromDescriptors,
  extractOperationTypeImportsFromDescriptors,
} from '@prisma-next/sql-tooling-assembly';

/**
 * SQL family descriptor for CLI config.
 * Provides the SQL family hook and assembly helpers.
 */
const sqlFamilyDescriptor: FamilyDescriptor = {
  kind: 'family',
  id: 'sql',
  hook: sqlTargetFamilyHook,
  assembleOperationRegistry: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => {
    return assembleOperationRegistryFromDescriptors(descriptors);
  },
  extractCodecTypeImports: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => {
    return extractCodecTypeImportsFromDescriptors(descriptors);
  },
  extractOperationTypeImports: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => {
    return extractOperationTypeImportsFromDescriptors(descriptors);
  },
};

export default sqlFamilyDescriptor;
