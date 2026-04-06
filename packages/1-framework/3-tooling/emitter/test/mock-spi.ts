import type { EmissionSpi } from '@prisma-next/framework-components/emission';

export function createMockSpi(overrides: Partial<EmissionSpi> = {}): EmissionSpi {
  return {
    id: 'sql',
    generateStorageType: () =>
      '{ readonly tables: Record<string, never>; readonly types: Record<string, never>; readonly storageHash: StorageHash }',
    generateModelStorageType: () => 'Record<string, never>',
    getFamilyImports: () => [
      "import type { ContractWithTypeMaps, TypeMaps as TypeMapsType } from '@prisma-next/sql-contract/types';",
    ],
    getFamilyTypeAliases: () => 'export type LaneCodecTypes = CodecTypes;',
    getTypeMapsExpression: () => 'TypeMapsType<CodecTypes, OperationTypes>',
    getContractWrapper: (base, tm) =>
      `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
    ...overrides,
  };
}
