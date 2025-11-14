// Re-export types from @prisma-next/contract for backward compatibility
export type {
  TargetFamilyHook,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
export type { EmitOptions, EmitResult } from '@prisma-next/core-control-plane/emission';
// Re-export emit function and types from core-control-plane
export { emit } from '@prisma-next/core-control-plane/emission';
