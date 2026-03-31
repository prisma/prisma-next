export interface DomainModelShape {
  readonly fields: Record<string, unknown>;
  readonly relations: Record<string, { readonly to: string }>;
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
}

export interface DomainContractShape {
  readonly roots: Record<string, string>;
  readonly models: Record<string, DomainModelShape>;
}

export interface DomainValidationResult {
  readonly warnings: string[];
}

export function validateContractDomain(contract: DomainContractShape): DomainValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const modelNames = new Set(Object.keys(contract.models));

  validateRoots(contract, modelNames, errors);
  validateVariantsAndBases(contract, modelNames, errors);
  validateRelationTargets(contract, modelNames, errors);
  validateDiscriminators(contract, errors);
  detectOrphanedModels(contract, modelNames, warnings);

  if (errors.length > 0) {
    throw new Error(`Contract domain validation failed:\n- ${errors.join('\n- ')}`);
  }

  return { warnings };
}

function validateRoots(
  contract: DomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  const seenValues = new Set<string>();
  for (const [rootKey, modelName] of Object.entries(contract.roots)) {
    if (seenValues.has(modelName)) {
      errors.push(`Duplicate root value: "${modelName}" is mapped by multiple root keys`);
    }
    seenValues.add(modelName);

    if (!modelNames.has(modelName)) {
      errors.push(
        `Root "${rootKey}" references model "${modelName}" which does not exist in models`,
      );
    }
  }
}

function validateVariantsAndBases(
  contract: DomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    if (model.variants) {
      for (const variantName of Object.keys(model.variants)) {
        if (!modelNames.has(variantName)) {
          errors.push(
            `Model "${modelName}" lists variant "${variantName}" which does not exist in models`,
          );
          continue;
        }
        const variantModel = contract.models[variantName];
        if (!variantModel) continue;
        if (variantModel.base !== modelName) {
          errors.push(
            `Variant "${variantName}" has base "${variantModel.base ?? '(none)'}" but expected "${modelName}"`,
          );
        }
      }
    }

    if (model.base) {
      if (!modelNames.has(model.base)) {
        errors.push(`Model "${modelName}" has base "${model.base}" which does not exist in models`);
        continue;
      }
      const baseModel = contract.models[model.base];
      if (!baseModel) continue;
      if (!baseModel.variants || !(modelName in baseModel.variants)) {
        errors.push(
          `Model "${modelName}" has base "${model.base}" which does not list it as a variant`,
        );
      }
    }
  }
}

function validateRelationTargets(
  contract: DomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    for (const [relName, relation] of Object.entries(model.relations)) {
      if (!modelNames.has(relation.to)) {
        errors.push(
          `Relation "${relName}" on model "${modelName}" targets "${relation.to}" which does not exist in models`,
        );
      }
    }
  }
}

function validateDiscriminators(contract: DomainContractShape, errors: string[]): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    if (model.discriminator) {
      if (!model.variants || Object.keys(model.variants).length === 0) {
        errors.push(`Model "${modelName}" has discriminator but no variants`);
      }
      if (!(model.discriminator.field in model.fields)) {
        errors.push(
          `Discriminator field "${model.discriminator.field}" is not a field on model "${modelName}"`,
        );
      }
    }

    // Single-level polymorphism only: a variant (model with `base`) cannot itself
    // declare discriminator/variants. Multi-level polymorphism is out of scope per ADR 2.
    if (model.base) {
      if (model.discriminator) {
        errors.push(`Model "${modelName}" has base and must not have discriminator`);
      }
      if (model.variants && Object.keys(model.variants).length > 0) {
        errors.push(`Model "${modelName}" has base and must not have variants`);
      }
    }
  }
}

function detectOrphanedModels(
  contract: DomainContractShape,
  modelNames: Set<string>,
  warnings: string[],
): void {
  const referenced = new Set<string>();

  for (const modelName of Object.values(contract.roots)) {
    referenced.add(modelName);
  }

  for (const model of Object.values(contract.models)) {
    for (const relation of Object.values(model.relations)) {
      referenced.add(relation.to);
    }
    if (model.variants) {
      for (const variantName of Object.keys(model.variants)) {
        referenced.add(variantName);
      }
    }
    if (model.base) {
      referenced.add(model.base);
    }
  }

  for (const modelName of modelNames) {
    if (!referenced.has(modelName)) {
      warnings.push(
        `Orphaned model: "${modelName}" is not referenced by any root, relation, or variant`,
      );
    }
  }
}
