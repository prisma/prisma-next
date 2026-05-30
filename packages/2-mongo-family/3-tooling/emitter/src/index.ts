import type { Contract, ContractModel } from '@prisma-next/contract/types';
import { serializeObjectKey, serializeValue } from '@prisma-next/emitter/domain-type-generation';
import type { ValidationContext } from '@prisma-next/framework-components/emission';
import {
  getStorageNamespace,
  type Namespace,
  storageNamespaceEntries,
  storageNamespaceValues,
} from '@prisma-next/framework-components/ir';
import type {
  MongoCollection,
  MongoNamespaceShape,
  MongoStorage,
} from '@prisma-next/mongo-contract';

const MONGO_NAMESPACE_KIND_FALLBACK = 'mongo-namespace' as const;

function mongoNamespaceSerializedKind(ns: Namespace): string {
  const kind = (ns as { kind?: unknown }).kind;
  if (typeof kind === 'string') {
    return `readonly kind: ${serializeValue(kind)}`;
  }
  return `readonly kind: '${MONGO_NAMESPACE_KIND_FALLBACK}'`;
}

function assertUniqueMongoCollectionNames(storage: MongoStorage): void {
  const seen = new Map<string, string>();
  for (const [namespaceId, ns] of [...storageNamespaceEntries(storage)]) {
    for (const coll of Object.keys((ns as MongoNamespaceShape).collections)) {
      const existing = seen.get(coll);
      if (existing !== undefined && existing !== namespaceId) {
        throw new Error(
          `Duplicate collection name "${coll}" in namespaces "${existing}" and "${namespaceId}"`,
        );
      }
      seen.set(coll, namespaceId);
    }
  }
}

function generateMongoCollectionEntryType(coll: MongoCollection): string {
  const entries = Object.entries(coll).filter(([key, v]) => v !== undefined && key !== 'kind');
  if (entries.length === 0) {
    return 'MongoCollection';
  }
  return serializeValue(coll);
}

function generateMongoNamespaceCollectionsType(
  collections: Readonly<Record<string, MongoCollection>>,
): string {
  const entries: string[] = [];
  for (const [collName, coll] of Object.entries(collections).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    entries.push(
      `readonly ${serializeObjectKey(collName)}: ${generateMongoCollectionEntryType(coll)}`,
    );
  }
  if (entries.length === 0) {
    return 'Record<string, never>';
  }
  return `{ ${entries.join('; ')} }`;
}

function generateMongoFlatStorageType(storage: MongoStorage): string {
  const sorted = [...storageNamespaceEntries(storage)].sort(([a], [b]) => a.localeCompare(b));
  if (sorted.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const [name, ns] of sorted) {
    const collectionsType = generateMongoNamespaceCollectionsType(
      (ns as MongoNamespaceShape).collections as Readonly<Record<string, MongoCollection>>,
    );
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}; ${mongoNamespaceSerializedKind(ns)}; readonly collections: ${collectionsType} }`,
    );
  }
  return `; ${parts.join('; ')}`;
}

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
          if (!match?.[1]) {
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
    if (!storage) {
      throw new Error('Mongo contract must have storage');
    }
    if (
      storageNamespaceValues(storage).length === 0 &&
      !getStorageNamespace(storage, '__unbound__')
    ) {
      throw new Error('Mongo contract must have at least one storage namespace entry');
    }

    assertUniqueMongoCollectionNames(storage);

    const collectionNames = new Set<string>();
    for (const ns of storageNamespaceValues(storage)) {
      for (const c of Object.keys((ns as MongoNamespaceShape).collections)) {
        collectionNames.add(c);
      }
    }

    const models = contract.models;
    if (!models || Object.keys(models).length === 0) return;

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
            `Model "${modelName}" references collection "${collection}" which is not in getStorageNamespace(storage, ..).collections`,
          );
        }
      }

      if (model.base) {
        const baseModel = models[model.base.model];
        if (!baseModel) {
          throw new Error(
            `Model "${modelName}" declares base "${model.base.model}" which does not exist in models`,
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

      const storageRelations = model.storage['relations'] as unknown as
        | Record<string, unknown>
        | undefined;
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
        const relObj = rel as unknown as Record<string, unknown>;
        const targetRef = relObj['to'] as { readonly model?: string } | undefined;
        const targetModelName = targetRef?.model;
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
    const flatType = generateMongoFlatStorageType(storage);
    return `{ readonly storageHash: ${storageHashTypeName}${flatType} }`;
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
      '  MongoCollection,',
      '  MongoContractWithTypeMaps,',
      '  MongoTypeMaps,',
      "} from '@prisma-next/mongo-contract';",
    ];
  },

  getFamilyTypeAliases(): string {
    return '';
  },

  getTypeMapsExpression(): string {
    return 'MongoTypeMaps<CodecTypes, FieldOutputTypes, FieldInputTypes>';
  },

  getContractWrapper(contractBaseName: string, typeMapsName: string): string {
    return `export type Contract = MongoContractWithTypeMaps<${contractBaseName}, ${typeMapsName}>;`;
  },
};
