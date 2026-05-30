import { storageNamespaceValues } from '@prisma-next/framework-components/ir';
import type { MongoContract } from './contract-types';
import type { MongoNamespace } from './ir/mongo-storage';

function formatCrossRef(crossRef: { readonly namespace: string; readonly model: string }): string {
  return `${crossRef.namespace}.${crossRef.model}`;
}

function storageDeclaresCollection(
  storage: MongoContract['storage'],
  collectionName: string,
): boolean {
  for (const ns of storageNamespaceValues(storage)) {
    if (Object.hasOwn((ns as MongoNamespace).collections, collectionName)) {
      return true;
    }
  }
  return false;
}

export function validateMongoStorage(contract: MongoContract): void {
  const errors: string[] = [];

  for (const [modelName, model] of Object.entries(contract.models)) {
    if (
      model.storage.collection &&
      !storageDeclaresCollection(contract.storage, model.storage.collection)
    ) {
      errors.push(
        `Model "${modelName}" references collection "${model.storage.collection}" which is not declared under any namespace's collections map`,
      );
    }

    if (model.base) {
      const baseModel = contract.models[model.base.model];
      if (baseModel) {
        const variantCollection = model.storage.collection;
        const baseCollection = baseModel.storage.collection;
        if (variantCollection !== baseCollection) {
          errors.push(
            `Mongo does not support multi-table inheritance; variant "${modelName}" must share its base's collection ("${baseCollection ?? '(none)'}"), but has "${variantCollection ?? '(none)'}"`,
          );
        }
      }
    }

    for (const [relName, relation] of Object.entries(model.relations ?? {})) {
      const targetModel = contract.models[relation.to.model];
      const targetLabel = formatCrossRef(relation.to);

      if (targetModel?.owner) {
        if (targetModel.owner !== modelName) {
          errors.push(
            `Embed relation "${relName}" targets "${targetLabel}" which is owned by "${targetModel.owner}", not "${modelName}"`,
          );
        }
        if (targetModel.storage.collection) {
          errors.push(
            `Embed relation "${relName}" targets "${targetLabel}" which must not have a collection`,
          );
        }
      } else if ('on' in relation && relation.on) {
        for (const localField of relation.on.localFields) {
          if (!(localField in model.fields)) {
            errors.push(
              `Reference relation "${relName}": localField "${localField}" is not a field on model "${modelName}"`,
            );
          }
        }

        if (targetModel) {
          for (const targetField of relation.on.targetFields) {
            if (!(targetField in targetModel.fields)) {
              errors.push(
                `Reference relation "${relName}": targetField "${targetField}" is not a field on model "${targetLabel}"`,
              );
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Contract storage validation failed:\n- ${errors.join('\n- ')}`);
  }
}
