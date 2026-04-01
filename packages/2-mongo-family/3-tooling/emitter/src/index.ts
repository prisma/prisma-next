import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  GenerateContractTypesOptions,
  TargetFamilyHook,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateHashTypeAliases,
  generateImportLines,
  generateModelRelationsType,
  generateRootsType,
  serializeObjectKey,
  serializeValue,
} from '@prisma-next/emitter/domain-type-generation';

interface MongoModelIR {
  readonly fields: Record<string, { readonly codecId: string; readonly nullable: boolean }>;
  readonly relations: Record<string, unknown>;
  readonly storage: Record<string, unknown>;
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
  readonly owner?: string;
}

interface MongoStorageIR {
  readonly collections: Record<string, Record<string, unknown>>;
}

function generateModelFieldsType(
  fields: Record<string, { readonly codecId: string; readonly nullable: boolean }>,
): string {
  const fieldEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    fieldEntries.push(
      `readonly ${serializeObjectKey(fieldName)}: { readonly codecId: ${serializeValue(field.codecId)}; readonly nullable: ${field.nullable} }`,
    );
  }
  return fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
}

function generateModelStorageType(model: MongoModelIR): string {
  const parts: string[] = [];
  const collection = model.storage['collection'] as string | undefined;
  if (collection) {
    parts.push(`readonly collection: ${serializeValue(collection)}`);
  }

  const storageRelations = model.storage['relations'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (storageRelations && Object.keys(storageRelations).length > 0) {
    const relEntries: string[] = [];
    for (const [relName, relVal] of Object.entries(storageRelations)) {
      relEntries.push(`readonly ${serializeObjectKey(relName)}: ${serializeValue(relVal)}`);
    }
    parts.push(`readonly relations: { ${relEntries.join('; ')} }`);
  }

  return parts.length > 0 ? `{ ${parts.join('; ')} }` : 'Record<string, never>';
}

function generateModelsType(models: Record<string, MongoModelIR>): string {
  if (!models || Object.keys(models).length === 0) {
    return 'Record<string, never>';
  }

  const modelTypes: string[] = [];
  for (const [modelName, model] of Object.entries(models)) {
    const fieldsType = generateModelFieldsType(model.fields);
    const relationsType = generateModelRelationsType(model.relations);
    const storageType = generateModelStorageType(model);

    const modelParts: string[] = [
      `readonly fields: ${fieldsType}`,
      `readonly relations: ${relationsType}`,
      `readonly storage: ${storageType}`,
    ];

    if (model.owner) {
      modelParts.push(`readonly owner: ${serializeValue(model.owner)}`);
    }
    if (model.discriminator) {
      modelParts.push(`readonly discriminator: ${serializeValue(model.discriminator)}`);
    }
    if (model.variants) {
      modelParts.push(`readonly variants: ${serializeValue(model.variants)}`);
    }
    if (model.base) {
      modelParts.push(`readonly base: ${serializeValue(model.base)}`);
    }

    modelTypes.push(`readonly ${modelName}: { ${modelParts.join('; ')} }`);
  }

  return `{ ${modelTypes.join('; ')} }`;
}

function generateStorageType(storage: MongoStorageIR): string {
  const collectionEntries: string[] = [];
  for (const [collName, collVal] of Object.entries(storage.collections)) {
    if (Object.keys(collVal).length === 0) {
      collectionEntries.push(`readonly ${serializeObjectKey(collName)}: Record<string, never>`);
    } else {
      collectionEntries.push(
        `readonly ${serializeObjectKey(collName)}: ${serializeValue(collVal)}`,
      );
    }
  }
  const collectionsType =
    collectionEntries.length > 0 ? `{ ${collectionEntries.join('; ')} }` : 'Record<string, never>';

  return `{ readonly collections: ${collectionsType} }`;
}

export const mongoTargetFamilyHook = {
  id: 'mongo',

  validateTypes(ir: ContractIR, _ctx: ValidationContext): void {
    const models = ir.models as Record<string, MongoModelIR> | undefined;
    if (!models) return;

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [modelName, model] of Object.entries(models)) {
      for (const [fieldName, field] of Object.entries(model.fields)) {
        const { codecId } = field;
        if (!codecId) {
          throw new Error(`Field "${fieldName}" on model "${modelName}" is missing codecId`);
        }
        const match = codecId.match(typeIdRegex);
        if (!match || !match[1]) {
          throw new Error(
            `Field "${fieldName}" on model "${modelName}" has invalid codec ID format "${codecId}". Expected format: ns/name@version`,
          );
        }
      }
    }
  },

  validateStructure(ir: ContractIR): void {
    if (ir.targetFamily !== 'mongo') {
      throw new Error(`Expected targetFamily "mongo", got "${ir.targetFamily}"`);
    }

    // ContractIR.storage is typed as generic Record; narrow to Mongo shape (validated below)
    const storage = ir.storage as unknown as MongoStorageIR | undefined;
    if (!storage || !storage.collections || typeof storage.collections !== 'object') {
      throw new Error('Mongo contract must have storage.collections');
    }

    const models = ir.models as Record<string, MongoModelIR> | undefined;
    if (!models) return;

    const collectionNames = new Set(Object.keys(storage.collections));

    for (const [modelName, model] of Object.entries(models)) {
      if (!model.fields || typeof model.fields !== 'object') {
        throw new Error(`Model "${modelName}" is missing required field "fields"`);
      }
      if (!model.relations || typeof model.relations !== 'object') {
        throw new Error(
          `Model "${modelName}" is missing required field "relations" (must be an object)`,
        );
      }
      if (!model.storage || typeof model.storage !== 'object') {
        throw new Error(
          `Model "${modelName}" is missing required field "storage" (must be an object)`,
        );
      }

      const collectionValue = model.storage['collection'];
      const collection = typeof collectionValue === 'string' ? collectionValue : undefined;

      if (model.owner) {
        if (collection) {
          throw new Error(
            `Owned model "${modelName}" must not have storage.collection (embedded models are stored within their owner)`,
          );
        }
        if (!models[model.owner]) {
          throw new Error(
            `Model "${modelName}" declares owner "${model.owner}" which does not exist in models`,
          );
        }
      } else if (collection) {
        if (!collectionNames.has(collection)) {
          throw new Error(
            `Model "${modelName}" references collection "${collection}" which is not in storage.collections`,
          );
        }
      }

      if (model.base) {
        const baseModel = models[model.base];
        if (!baseModel) {
          throw new Error(
            `Model "${modelName}" declares base "${model.base}" which does not exist in models`,
          );
        }
        const variantCollection = collection;
        const baseCollection = baseModel.storage['collection'] as string | undefined;
        if (variantCollection !== baseCollection) {
          throw new Error(
            `Variant "${modelName}" must share its base's collection ("${baseCollection ?? '(none)'}"), but has "${variantCollection ?? '(none)'}"`,
          );
        }
      }

      const storageRelations = model.storage['relations'] as Record<string, unknown> | undefined;
      if (storageRelations) {
        for (const relName of Object.keys(storageRelations)) {
          if (!model.relations[relName]) {
            throw new Error(
              `Model "${modelName}" has storage.relations.${relName} but no matching domain-level relation`,
            );
          }
        }
      }

      for (const [relName, rel] of Object.entries(model.relations)) {
        const relObj = rel as Record<string, unknown>;
        const targetModelName = relObj['to'] as string | undefined;
        if (targetModelName) {
          const targetModel = models[targetModelName];
          if (targetModel?.owner === modelName && !storageRelations?.[relName]) {
            throw new Error(
              `Model "${modelName}" has embed relation "${relName}" to owned model "${targetModelName}" but no matching storage.relations entry`,
            );
          }
        }
      }
    }
  },

  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
    hashes: {
      readonly storageHash: string;
      readonly executionHash?: string;
      readonly profileHash: string;
    },
    options?: GenerateContractTypesOptions,
  ): string {
    const parameterizedTypeImports = options?.parameterizedTypeImports;
    const models = ir.models as Record<string, MongoModelIR>;
    // ContractIR.storage is typed as generic Record; narrow to Mongo shape (validated by validateStructure)
    const storage = ir.storage as unknown as MongoStorageIR;

    const allImports: TypesImportSpec[] = [...codecTypeImports, ...operationTypeImports];
    if (parameterizedTypeImports) {
      allImports.push(...parameterizedTypeImports);
    }

    const uniqueImports = deduplicateImports(allImports);
    const importLines = generateImportLines(uniqueImports);

    const codecTypes = generateCodecTypeIntersection(codecTypeImports, 'CodecTypes');
    const operationTypes = generateCodecTypeIntersection(operationTypeImports, 'OperationTypes');

    const hashAliases = generateHashTypeAliases(hashes);
    const rootsType = generateRootsType(ir.roots);
    const modelsType = generateModelsType(models);
    const storageTypeDef = generateStorageType(storage);

    return `// ⚠️  GENERATED FILE - DO NOT EDIT
// This file is automatically generated by 'prisma-next contract emit'.
// To regenerate, run: prisma-next contract emit
${importLines.join('\n')}

import type {
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';
import type {
  ExecutionHashBase,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';

${hashAliases}

export type CodecTypes = ${codecTypes};
export type OperationTypes = ${operationTypes};
export type TypeMaps = MongoTypeMaps<CodecTypes, OperationTypes>;

type ContractBase = {
  readonly schemaVersion: ${serializeValue(ir.schemaVersion)};
  readonly target: ${serializeValue(ir.target)};
  readonly targetFamily: ${serializeValue(ir.targetFamily)};
  readonly storageHash: StorageHash;
  readonly executionHash?: ExecutionHash;
  readonly profileHash: ProfileHash;
  readonly capabilities: ${serializeValue(ir.capabilities)};
  readonly extensionPacks: ${serializeValue(ir.extensionPacks)};
  readonly meta: ${serializeValue(ir.meta)};
  readonly sources: ${serializeValue(ir.sources)};
  readonly roots: ${rootsType};
  readonly models: ${modelsType};
  readonly storage: ${storageTypeDef};
};

export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>;
`;
  },
} as const satisfies TargetFamilyHook;
