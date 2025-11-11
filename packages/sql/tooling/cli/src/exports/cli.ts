import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/cli/config-types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
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
  validateContractIR: (contractJson: unknown) => {
    // Validate the contract (this normalizes and validates structure/logic)
    const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
    // Strip mappings before returning ContractIR (mappings are runtime-only)
    const { mappings: _mappings, ...contractIR } = validated;
    return contractIR;
  },
  stripMappings: (contract: unknown) => {
    // Type guard to check if contract has mappings
    if (typeof contract === 'object' && contract !== null && 'mappings' in contract) {
      const { mappings: _mappings, ...contractIR } = contract as {
        mappings?: unknown;
        [key: string]: unknown;
      };
      return contractIR;
    }
    return contract;
  },
};

export default sqlFamilyDescriptor;
