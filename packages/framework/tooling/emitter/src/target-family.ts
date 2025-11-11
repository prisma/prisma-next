import type { ContractIR } from '@prisma-next/contract/ir';
import type { OperationRegistry } from '@prisma-next/operations';
import type { TypesImportSpec } from './types';

export interface ValidationContext {
  readonly operationRegistry?: OperationRegistry;
  readonly typeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface TargetFamilyHook {
  readonly id: string;

  validateTypes(ir: ContractIR, ctx: ValidationContext): void;

  validateStructure(ir: ContractIR): void;

  generateContractTypes(ir: ContractIR, typeImports: ReadonlyArray<TypesImportSpec>): string;
}
