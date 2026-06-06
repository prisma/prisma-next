import type { Contract, ContractModel, ContractValueObject } from '@prisma-next/contract/types';
import { DomainNamespaceResolutionError } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type {
  EmissionSpi,
  GenerateContractTypesOptions,
  TypesImportSpec,
} from '@prisma-next/framework-components/emission';
import { blindCast } from '@prisma-next/utils/casts';
import {
  deduplicateImports,
  generateBothFieldTypesMaps,
  generateCodecTypeIntersection,
  generateHashTypeAliases,
  generateImportLines,
  generateModelsType,
  generateRootsType,
  generateValueObjectsDescriptorType,
  generateValueObjectTypeAliases,
  serializeExecutionType,
  serializeValue,
} from './domain-type-generation';

export function generateContractDts(
  contract: Contract,
  emitter: EmissionSpi,
  codecTypeImports: ReadonlyArray<TypesImportSpec>,
  hashes: {
    readonly storageHash: string;
    readonly executionHash?: string;
    readonly profileHash: string;
  },
  options?: GenerateContractTypesOptions,
  codecLookup?: CodecLookup,
): string {
  const allImports: TypesImportSpec[] = [...codecTypeImports];
  if (options?.queryOperationTypeImports) {
    allImports.push(...options.queryOperationTypeImports);
  }
  const uniqueImports = deduplicateImports(allImports);
  const importLines = generateImportLines(uniqueImports);

  const familyImportLines = emitter.getFamilyImports();

  const hashAliases = generateHashTypeAliases(hashes);

  const codecTypes = generateCodecTypeIntersection(codecTypeImports, 'CodecTypes');

  const familyTypeAliases = emitter.getFamilyTypeAliases(options);

  const typeMapsExpr = emitter.getTypeMapsExpression();

  const storageType = emitter.generateStorageType(contract, 'StorageHash');

  const namespaceEntries = Object.entries(contract.domain.namespaces);
  if (namespaceEntries.length === 0) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }

  // Validate all namespace entries are present.
  for (const [nsId, ns] of namespaceEntries) {
    if (ns === undefined) {
      throw new Error(`domain namespace "${nsId}" is not present on the contract`);
    }
  }

  // Flatten all namespace models into one record — first-name-wins on bare-name collision.
  // This is the documented ORM flatten behaviour; the proper per-namespace .d.ts redesign
  // is explicit-namespace-dsl's job (not this interim unblock).
  const modelsRecord: Record<string, ContractModel> = {};
  for (const [, ns] of namespaceEntries) {
    for (const [modelName, model] of Object.entries(
      blindCast<
        Record<string, ContractModel>,
        'ns.models is a ContractModel record in the emitted IR'
      >(ns.models),
    )) {
      if (!(modelName in modelsRecord)) {
        modelsRecord[modelName] = model;
      }
    }
  }
  const modelsType = generateModelsType(modelsRecord, (name, model) =>
    emitter.generateModelStorageType(name, model),
  );

  const rootsType = generateRootsType(contract.roots);

  // Flatten value objects across all namespaces — first-name-wins on collision.
  const flatValueObjects: Record<string, ContractValueObject> = {};
  for (const [, ns] of namespaceEntries) {
    for (const [voName, vo] of Object.entries(
      blindCast<
        Record<string, ContractValueObject>,
        'ns.valueObjects is a ContractValueObject record in the emitted IR (default to {} when absent)'
      >(ns.valueObjects ?? {}),
    )) {
      if (!(voName in flatValueObjects)) {
        flatValueObjects[voName] = vo;
      }
    }
  }
  const valueObjects = Object.keys(flatValueObjects).length > 0 ? flatValueObjects : undefined;
  const valueObjectTypeAliases = generateValueObjectTypeAliases(valueObjects, codecLookup);
  const valueObjectsDescriptor = generateValueObjectsDescriptorType(valueObjects);

  // Per-namespace models and value objects types for the domain.namespaces section of ContractBase.
  const perNamespaceTypes: Array<readonly [string, string, string | undefined]> =
    namespaceEntries.map(([nsId, ns]) => {
      const nsModels = blindCast<
        Record<string, ContractModel>,
        'ns.models is a ContractModel record in the emitted IR'
      >(ns.models);
      const nsModelsType = generateModelsType(nsModels, (name, model) =>
        emitter.generateModelStorageType(name, model),
      );
      const nsValueObjects = blindCast<
        Record<string, ContractValueObject> | undefined,
        'ns.valueObjects is an optional ContractValueObject record in the emitted IR'
      >(ns.valueObjects);
      const nsValueObjectsDescriptor =
        nsValueObjects !== undefined && Object.keys(nsValueObjects).length > 0
          ? generateValueObjectsDescriptorType(nsValueObjects)
          : undefined;
      return [nsId, nsModelsType, nsValueObjectsDescriptor] as const;
    });

  const domainNamespacesType = perNamespaceTypes
    .map(([nsId, nsModelsType, nsValueObjectsDescriptor]) => {
      const voLine =
        nsValueObjectsDescriptor !== undefined
          ? `\n        readonly valueObjects: ${nsValueObjectsDescriptor};`
          : '';
      return `      readonly ${nsId}: {\n        readonly models: ${nsModelsType};${voLine}\n      }`;
    })
    .join(';\n');

  const executionClause =
    contract.execution !== undefined
      ? `\n  readonly execution: ${serializeExecutionType(contract.execution)};`
      : '';

  const resolveFieldTypeParams = emitter.resolveFieldTypeParams
    ? (modelName: string, fieldName: string, model: ContractModel) =>
        emitter.resolveFieldTypeParams?.(modelName, fieldName, model, contract)
    : undefined;

  const fieldTypesMaps = generateBothFieldTypesMaps(
    modelsRecord,
    codecLookup,
    resolveFieldTypeParams,
  );

  const contractWrapper = emitter.getContractWrapper('ContractBase', 'TypeMaps');

  return `// ⚠️  GENERATED FILE - DO NOT EDIT
// This file is automatically generated by 'prisma-next contract emit'.
// To regenerate, run: prisma-next contract emit
${importLines.join('\n')}

${familyImportLines.join('\n')}
import type {
  Contract as ContractType,
  ContractModelDefinitions,
  ExecutionHashBase,
  NamespaceId,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';

${hashAliases}

export type CodecTypes = ${codecTypes};
${familyTypeAliases}
${valueObjectTypeAliases}
export type FieldOutputTypes = ${fieldTypesMaps.output};
export type FieldInputTypes = ${fieldTypesMaps.input};
export type TypeMaps = ${typeMapsExpr};

type ContractBase = Omit<
  ContractType<
${storageType},
${modelsType}
  >,
  'roots' | 'domain'
> & {
  readonly target: ${serializeValue(contract.target)};
  readonly targetFamily: ${serializeValue(contract.targetFamily)};
  readonly roots: ${rootsType};
  readonly domain: {
    readonly namespaces: {
${domainNamespacesType};
    };
  };
  readonly capabilities: ${serializeValue(contract.capabilities)};
  readonly extensionPacks: ${serializeValue(contract.extensionPacks)};${executionClause}
  readonly meta: ${serializeValue(contract.meta)};
  ${valueObjects ? `readonly valueObjects: ${valueObjectsDescriptor};` : ''}
  readonly profileHash: ProfileHash;
};

export type Models = ContractModelDefinitions<Contract>;

${contractWrapper}
`;
}
