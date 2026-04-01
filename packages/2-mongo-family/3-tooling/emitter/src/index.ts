import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  GenerateContractTypesOptions,
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

      const collection = model.storage['collection'] as string | undefined;

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
        if (baseModel) {
          const variantCollection = collection;
          const baseCollection = baseModel.storage['collection'] as string | undefined;
          if (variantCollection !== baseCollection) {
            throw new Error(
              `Variant "${modelName}" must share its base's collection ("${baseCollection ?? '(none)'}"), but has "${variantCollection ?? '(none)'}"`,
            );
          }
        }
      }

      const storageRelations = model.storage['relations'] as Record<string, unknown> | undefined;
      if (storageRelations) {
        for (const [relName, _relVal] of Object.entries(storageRelations)) {
          const targetModel = Object.entries(models).find(
            ([, m]) => m.owner === modelName && Object.keys(m.relations).length === 0,
          );
          if (!targetModel) {
            const relatedModels = Object.entries(models).filter(([, m]) => m.owner === modelName);
            if (relatedModels.length === 0) {
              throw new Error(
                `Model "${modelName}" has storage.relations.${relName} but no model declares owner "${modelName}"`,
              );
            }
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
    const storage = ir.storage as unknown as MongoStorageIR;

    const allImports: TypesImportSpec[] = [...codecTypeImports, ...operationTypeImports];
    if (parameterizedTypeImports) {
      allImports.push(...parameterizedTypeImports);
    }

    const uniqueImports = deduplicateImports(allImports);
    const importLines = generateImportLines(uniqueImports);

    const codecTypes = generateCodecTypeIntersection(codecTypeImports, 'CodecTypes');

    const hashAliases = generateHashTypeAliases(hashes);
    const rootsType = generateRootsType(ir.roots);
    const modelsType = this.generateModelsType(models);
    const storageType = this.generateStorageType(storage);

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
export type TypeMaps = MongoTypeMaps<CodecTypes>;

type ContractBase = {
  readonly schemaVersion: ${serializeValue(ir.schemaVersion)};
  readonly target: ${serializeValue(ir.target)};
  readonly targetFamily: ${serializeValue(ir.targetFamily)};
  readonly storageHash: StorageHash;
  readonly profileHash: ProfileHash;
  readonly capabilities: ${serializeValue(ir.capabilities)};
  readonly extensionPacks: ${serializeValue(ir.extensionPacks)};
  readonly meta: ${serializeValue(ir.meta)};
  readonly sources: ${serializeValue(ir.sources)};
  readonly roots: ${rootsType};
  readonly models: ${modelsType};
  readonly storage: ${storageType};
};

export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>;
`;
  },

  generateModelsType(models: Record<string, MongoModelIR>): string {
    if (!models || Object.keys(models).length === 0) {
      return 'Record<string, never>';
    }

    const modelTypes: string[] = [];
    for (const [modelName, model] of Object.entries(models)) {
      const fieldsType = this.generateModelFieldsType(model.fields);
      const relationsType = generateModelRelationsType(model.relations);
      const storageType = this.generateModelStorageType(model);

      const modelParts: string[] = [
        `fields: ${fieldsType}`,
        `relations: ${relationsType}`,
        `storage: ${storageType}`,
      ];

      if (model.owner) {
        modelParts.push(`owner: ${serializeValue(model.owner)}`);
      }
      if (model.discriminator) {
        modelParts.push(`discriminator: ${serializeValue(model.discriminator)}`);
      }
      if (model.variants) {
        modelParts.push(`variants: ${serializeValue(model.variants)}`);
      }
      if (model.base) {
        modelParts.push(`base: ${serializeValue(model.base)}`);
      }

      modelTypes.push(`readonly ${modelName}: { ${modelParts.join('; ')} }`);
    }

    return `{ ${modelTypes.join('; ')} }`;
  },

  generateModelFieldsType(
    fields: Record<string, { readonly codecId: string; readonly nullable: boolean }>,
  ): string {
    const fieldEntries: string[] = [];
    for (const [fieldName, field] of Object.entries(fields)) {
      fieldEntries.push(
        `readonly ${serializeObjectKey(fieldName)}: { readonly codecId: ${serializeValue(field.codecId)}; readonly nullable: ${field.nullable} }`,
      );
    }
    return fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
  },

  generateModelStorageType(model: MongoModelIR): string {
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
  },

  generateStorageType(storage: MongoStorageIR): string {
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
      collectionEntries.length > 0
        ? `{ ${collectionEntries.join('; ')} }`
        : 'Record<string, never>';

    return `{ readonly collections: ${collectionsType} }`;
  },
} as const;
