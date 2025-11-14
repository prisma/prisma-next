// Re-export core-control-plane descriptor types for convenience
export type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/config-types';
export type { DriverDescriptor } from '@prisma-next/core-control-plane/types';
// Export CLI-specific config types
export type { ContractConfig, PrismaNextConfig } from '../config-types';
export { defineConfig } from '../config-types';
