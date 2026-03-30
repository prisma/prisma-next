import type { MongoContract } from './contract-types';

export function validateMongoStorage(contract: MongoContract): void {
  const errors: string[] = [];

  for (const [modelName, model] of Object.entries(contract.models)) {
    if (model.storage.collection && !(model.storage.collection in contract.storage.collections)) {
      errors.push(
        `Model "${modelName}" references collection "${model.storage.collection}" which is not in storage.collections`,
      );
    }

    if (model.base) {
      const baseModel = contract.models[model.base];
      if (baseModel) {
        const variantCollection = model.storage.collection;
        const baseCollection = baseModel.storage.collection;
        if (variantCollection !== baseCollection) {
          errors.push(
            `Variant "${modelName}" has collection "${variantCollection ?? '(none)'}" but its base "${model.base}" has collection "${baseCollection ?? '(none)'}" — they must match`,
          );
        }
      }
    }

    for (const [relName, relation] of Object.entries(model.relations)) {
      if (relation.strategy === 'embed') {
        const target = contract.models[relation.to];
        if (target?.storage.collection) {
          errors.push(
            `Embed relation "${relName}" targets "${relation.to}" which must not have a collection`,
          );
        }
      }

      if (relation.strategy === 'reference') {
        for (const localField of relation.on.localFields) {
          if (!(localField in model.fields)) {
            errors.push(
              `Reference relation "${relName}": localField "${localField}" is not a field on model "${modelName}"`,
            );
          }
        }

        const targetModel = contract.models[relation.to];
        if (targetModel) {
          for (const targetField of relation.on.targetFields) {
            if (!(targetField in targetModel.fields)) {
              errors.push(
                `Reference relation "${relName}": targetField "${targetField}" is not a field on model "${relation.to}"`,
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
