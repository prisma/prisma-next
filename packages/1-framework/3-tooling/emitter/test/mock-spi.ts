import type { EmissionSpi, ValidationContext } from '@prisma-next/framework-components/emission';

export function createMockSpi(overrides: Partial<EmissionSpi> = {}): EmissionSpi {
  return {
    id: 'sql',
    validateTypes: (contract, _ctx: ValidationContext) => {
      const storage = contract.storage as
        | { tables?: Record<string, { columns?: Record<string, { codecId?: string }> }> }
        | undefined;
      if (!storage?.tables) return;

      const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;
      for (const [tableName, table] of Object.entries(storage.tables)) {
        if (!table.columns) continue;
        for (const [colName, col] of Object.entries(table.columns)) {
          if (!col.codecId) {
            throw new Error(`Column "${colName}" in table "${tableName}" is missing codecId`);
          }
          if (!typeIdRegex.test(col.codecId)) {
            throw new Error(
              `Column "${colName}" in table "${tableName}" has invalid codecId format "${col.codecId}". Expected format: ns/name@version`,
            );
          }
        }
      }
    },
    validateStructure: (contract) => {
      if (contract.targetFamily !== 'sql') {
        throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
      }
    },
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
