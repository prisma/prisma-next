import { ContractValidationError } from './validate-contract';

export interface DomainModelShape {
  readonly fields: Record<string, unknown>;
  readonly relations?: Record<string, { readonly to: string }>;
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
  readonly owner?: string;
}

export interface DomainContractShape {
  readonly roots: Record<string, string>;
  readonly models: Record<string, DomainModelShape>;
  readonly valueObjects?: Record<string, { readonly fields: Record<string, unknown> }>;
}

export function validateContractDomain(contract: DomainContractShape): void {
  const errors: string[] = [];
  const modelNames = new Set(Object.keys(contract.models));

  validateRoots(contract, modelNames, errors);
  validateVariantsAndBases(contract, modelNames, errors);
  validateRelationTargets(contract, modelNames, errors);
  validateDiscriminators(contract, errors);
  validateOwnership(contract, modelNames, errors);
  validateValueObjectReferences(contract, errors);
  validateFieldModifiers(contract, errors);

  if (errors.length > 0) {
    throw new ContractValidationError(
      `Contract domain validation failed:\n- ${errors.join('\n- ')}`,
      'domain',
    );
  }
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
  const models = new Map(Object.entries(contract.models));

  for (const [modelName, model] of models) {
    if (model.variants) {
      for (const variantName of Object.keys(model.variants)) {
        if (!modelNames.has(variantName)) {
          errors.push(
            `Model "${modelName}" lists variant "${variantName}" which does not exist in models`,
          );
          continue;
        }
        const variantModel = models.get(variantName);
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
      const baseModel = models.get(model.base);
      if (!baseModel) continue;
      if (!baseModel.variants || !Object.hasOwn(baseModel.variants, modelName)) {
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
    for (const [relName, relation] of Object.entries(model.relations ?? {})) {
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
      if (!Object.hasOwn(model.fields, model.discriminator.field)) {
        errors.push(
          `Discriminator field "${model.discriminator.field}" is not a field on model "${modelName}"`,
        );
      }
    }

    if (model.variants && Object.keys(model.variants).length > 0 && !model.discriminator) {
      errors.push(`Model "${modelName}" has variants but no discriminator`);
    }

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

function validateOwnership(
  contract: DomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    if (!model.owner) continue;

    if (model.owner === modelName) {
      errors.push(`Model "${modelName}" cannot own itself`);
    }

    if (!modelNames.has(model.owner)) {
      errors.push(`Model "${modelName}" has owner "${model.owner}" which does not exist in models`);
    }

    for (const [rootKey, rootModel] of Object.entries(contract.roots)) {
      if (rootModel === modelName) {
        errors.push(
          `Owned model "${modelName}" must not appear in roots (found as root "${rootKey}")`,
        );
      }
    }
  }
}

interface FieldLike {
  readonly type?: { readonly kind?: string; readonly name?: string };
  readonly many?: boolean;
  readonly dict?: boolean;
}

function validateValueObjectReferences(contract: DomainContractShape, errors: string[]): void {
  const voNames = new Set(Object.keys(contract.valueObjects ?? {}));

  function checkField(field: unknown, location: string): void {
    const f = field as FieldLike | undefined;
    if (f?.type?.kind === 'valueObject' && f.type.name) {
      if (!voNames.has(f.type.name)) {
        errors.push(
          `${location} references value object "${f.type.name}" which does not exist in valueObjects`,
        );
      }
    }
  }

  for (const [modelName, model] of Object.entries(contract.models)) {
    for (const [fieldName, field] of Object.entries(model.fields)) {
      checkField(field, `Model "${modelName}" field "${fieldName}"`);
    }
  }

  for (const [voName, vo] of Object.entries(contract.valueObjects ?? {})) {
    for (const [fieldName, field] of Object.entries(vo.fields)) {
      checkField(field, `Value object "${voName}" field "${fieldName}"`);
    }
  }
}

function validateFieldModifiers(contract: DomainContractShape, errors: string[]): void {
  function checkField(field: unknown, location: string): void {
    const f = field as FieldLike | undefined;
    if (f?.many && f?.dict) {
      errors.push(`${location} cannot have both "many" and "dict" modifiers`);
    }
  }

  for (const [modelName, model] of Object.entries(contract.models)) {
    for (const [fieldName, field] of Object.entries(model.fields)) {
      checkField(field, `Model "${modelName}" field "${fieldName}"`);
    }
  }

  for (const [voName, vo] of Object.entries(contract.valueObjects ?? {})) {
    for (const [fieldName, field] of Object.entries(vo.fields)) {
      checkField(field, `Value object "${voName}" field "${fieldName}"`);
    }
  }
}
