import type { Contract, ContractField, ContractModelBase } from '@prisma-next/contract/types';
import type {
  EmissionSpi,
  ResolvedFieldTypeStrings,
} from '@prisma-next/framework-components/emission';
import { serializeValue } from '../src/domain-type-generation';

function resolveEnumMemberValues(
  field: ContractField,
  contract: Contract,
): ResolvedFieldTypeStrings | undefined {
  const valueSet = field.valueSet;
  if (!valueSet || valueSet.entityKind !== 'enum') return undefined;

  const ns = contract.domain.namespaces[valueSet.namespaceId];
  if (!ns) return undefined;

  const entry = ns.enum?.[valueSet.entityName];
  if (!entry?.members?.length) return undefined;

  const literals = entry.members.map((m) => serializeValue(m.value));
  const union = literals.join(' | ');
  const resolved = field.nullable ? `${union} | null` : union;
  return { output: resolved, input: resolved };
}

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
    getTypeMapsExpression: () => 'TypeMapsType<CodecTypes>',
    getContractWrapper: (base, tm) =>
      `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
    resolveFieldType(
      _modelName: string,
      _fieldName: string,
      field: ContractField,
      _model: ContractModelBase,
      contract: Contract,
    ): ResolvedFieldTypeStrings | undefined {
      return resolveEnumMemberValues(field, contract);
    },
    ...overrides,
  };
}
