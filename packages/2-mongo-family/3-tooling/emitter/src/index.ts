import type { Contract, ContractModel } from '@prisma-next/contract/types';
import { serializeObjectKey, serializeValue } from '@prisma-next/emitter/domain-type-generation';
import type { ValidationContext } from '@prisma-next/framework-components/emission';
import type { MongoStorage } from '@prisma-next/mongo-contract';

export const mongoEmission = {
  id: 'mongo',

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [modelName, model] of Object.entries(contract.models)) {
      for (const [fieldName, field] of Object.entries(model.fields)) {
        const fieldType = (
          field as {
            type?: {
              kind: string;
              codecId?: string;
              members?: ReadonlyArray<{ kind: string; codecId?: string }>;
            };
          }
        ).type;
        if (!fieldType) continue;

        const scalarTypes: Array<{ codecId?: string }> =
          fieldType.kind === 'scalar'
            ? [fieldType]
            : fieldType.kind === 'union' && fieldType.members
              ? fieldType.members.filter((m) => m.kind === 'scalar')
              : [];

        for (const scalarType of scalarTypes) {
          const { codecId } = scalarType;
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
    }
  },

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'mongo') {
      throw new Error(`Expected targetFamily "mongo", got "${contract.targetFamily}"`);
    }

    const storage = contract.storage as MongoStorage | undefined;
    if (!storage || !storage.collections || typeof storage.collections !== 'object') {
      throw new Error('Mongo contract must have storage.collections');
    }

    const models = contract.models;
    if (!models || Object.keys(models).length === 0) return;

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

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as MongoStorage;
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

    return `{ readonly collections: ${collectionsType}; readonly storageHash: ${storageHashTypeName} }`;
  },

  generateModelStorageType(_modelName: string, model: ContractModel): string {
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

  getFamilyImports(): string[] {
    return [
      'import type {',
      '  MongoContractWithTypeMaps,',
      '  MongoTypeMaps,',
      "} from '@prisma-next/mongo-contract';",
    ];
  },

  getFamilyTypeAliases(): string {
    return '';
  },

  getTypeMapsExpression(): string {
    return 'MongoTypeMaps<CodecTypes, OperationTypes, FieldOutputTypes, FieldInputTypes>';
  },

  getContractWrapper(contractBaseName: string, typeMapsName: string): string {
    return `export type Contract = MongoContractWithTypeMaps<${contractBaseName}, ${typeMapsName}>;`;
  },
};
