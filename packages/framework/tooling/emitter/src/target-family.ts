import type { ContractIR, ExtensionPack, ExtensionPackManifest, TypesImportSpec } from './types';

export interface TargetFamilyHook {
  readonly id: string;

  validateTypes(ir: ContractIR, packManifests: ReadonlyArray<ExtensionPackManifest>): void;

  validateStructure(ir: ContractIR): void;

  generateContractTypes(ir: ContractIR, packs: ReadonlyArray<ExtensionPack>): string;

  getTypesImports(packs: ReadonlyArray<ExtensionPack>): ReadonlyArray<TypesImportSpec>;
}
