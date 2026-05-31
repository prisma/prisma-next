import { ifDefined } from '@prisma-next/utils/defined';
import { ContractValidationError } from './contract-validation-error';
import type { CrossReference } from './cross-reference';
import { contractModels, contractValueObjects, type DomainContractSlice } from './domain-envelope';

export interface DomainModelShape {
  readonly fields: Record<string, unknown>;
  readonly relations?: Record<string, { readonly to: CrossReference }>;
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, unknown>;
  readonly base?: CrossReference;
  readonly owner?: string;
}

export interface DomainContractShape extends DomainContractSlice {
  readonly roots: Record<string, CrossReference>;
}

type FlatDomainContractShape = {
  readonly roots: Record<string, CrossReference>;
  readonly models: Record<string, DomainModelShape>;
  readonly valueObjects?: Record<string, { readonly fields: Record<string, unknown> }>;
};

function flattenDomainContract(contract: DomainContractShape): FlatDomainContractShape {
  return {
    roots: contract.roots,
    models: contractModels(contract),
    ...ifDefined('valueObjects', contractValueObjects(contract)),
  };
}

export function validateContractDomain(contract: DomainContractShape): void {
  const flat = flattenDomainContract(contract);
  const errors: string[] = [];
  const modelNames = new Set(Object.keys(flat.models));

  validateRoots(flat, modelNames, errors);
  validateVariantsAndBases(flat, modelNames, errors);
  validateRelationTargets(flat, modelNames, errors);
  validateDiscriminators(flat, errors);
  validateOwnership(flat, modelNames, errors);
  validateValueObjectReferences(flat, errors);
  validateFieldModifiers(flat, errors);

  if (errors.length > 0) {
    throw new ContractValidationError(
      `Contract domain validation failed:\n- ${errors.join('\n- ')}`,
      'domain',
    );
  }
}

function validateRoots(
  contract: FlatDomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  const seenValues = new Set<string>();
  for (const [rootKey, crossRef] of Object.entries(contract.roots)) {
    const modelName = crossRef.model;
    const dedupeKey = `${crossRef.namespace}:${modelName}`;
    if (seenValues.has(dedupeKey)) {
      errors.push(`Duplicate root value: "${modelName}" is mapped by multiple root keys`);
    }
    seenValues.add(dedupeKey);

    if (!modelNames.has(modelName)) {
      errors.push(
        `Root "${rootKey}" references model "${modelName}" which does not exist in models`,
      );
    }
  }
}

function validateVariantsAndBases(
  contract: FlatDomainContractShape,
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
        if (variantModel.base?.model !== modelName) {
          errors.push(
            `Variant "${variantName}" has base "${variantModel.base?.model ?? '(none)'}" but expected "${modelName}"`,
          );
        }
      }
    }

    if (model.base) {
      const baseModelName = model.base.model;
      if (!modelNames.has(baseModelName)) {
        errors.push(
          `Model "${modelName}" has base "${baseModelName}" which does not exist in models`,
        );
        continue;
      }
      const baseModel = models.get(baseModelName);
      if (!baseModel) continue;
      if (!baseModel.variants || !Object.hasOwn(baseModel.variants, modelName)) {
        errors.push(
          `Model "${modelName}" has base "${baseModelName}" which does not list it as a variant`,
        );
      }
    }
  }
}

function validateRelationTargets(
  contract: FlatDomainContractShape,
  modelNames: Set<string>,
  errors: string[],
): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    for (const [relName, relation] of Object.entries(model.relations ?? {})) {
      const targetModelName = relation.to.model;
      if (!modelNames.has(targetModelName)) {
        errors.push(
          `Relation "${relName}" on model "${modelName}" targets "${targetModelName}" which does not exist in models`,
        );
      }
    }
  }
}

function validateDiscriminators(contract: FlatDomainContractShape, errors: string[]): void {
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
  contract: FlatDomainContractShape,
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

    for (const [rootKey, rootRef] of Object.entries(contract.roots)) {
      if (rootRef.model === modelName) {
        errors.push(
          `Owned model "${modelName}" must not appear in roots (found as root "${rootKey}")`,
        );
      }
    }
  }
}

interface FieldTypeLike {
  readonly kind?: string;
  readonly name?: string;
  readonly members?: readonly FieldTypeLike[];
}

interface FieldLike {
  readonly type?: FieldTypeLike;
  readonly many?: boolean;
  readonly dict?: boolean;
}

function forEachContractField(
  contract: FlatDomainContractShape,
  callback: (field: unknown, location: string) => void,
): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    for (const [fieldName, field] of Object.entries(model.fields)) {
      callback(field, `Model "${modelName}" field "${fieldName}"`);
    }
  }
  for (const [voName, vo] of Object.entries(contract.valueObjects ?? {})) {
    for (const [fieldName, field] of Object.entries(vo.fields)) {
      callback(field, `Value object "${voName}" field "${fieldName}"`);
    }
  }
}

function validateValueObjectReferences(contract: FlatDomainContractShape, errors: string[]): void {
  const voNames = new Set(Object.keys(contract.valueObjects ?? {}));

  function checkType(type: FieldTypeLike | undefined, location: string): void {
    if (!type) return;
    if (type.kind === 'valueObject' && type.name && !voNames.has(type.name)) {
      errors.push(
        `${location} references value object "${type.name}" which does not exist in valueObjects`,
      );
      return;
    }
    if (type.kind === 'union') {
      for (const member of type.members ?? []) checkType(member, location);
    }
  }

  forEachContractField(contract, (field, location) => {
    const f = field as FieldLike | undefined;
    checkType(f?.type, location);
  });
}

function validateFieldModifiers(contract: FlatDomainContractShape, errors: string[]): void {
  forEachContractField(contract, (field, location) => {
    const f = field as FieldLike | undefined;
    if (f?.many && f?.dict) {
      errors.push(`${location} cannot have both "many" and "dict" modifiers`);
    }
  });
}
