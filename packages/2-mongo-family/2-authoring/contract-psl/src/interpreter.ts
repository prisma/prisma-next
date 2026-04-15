import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import type {
  Contract,
  ContractField,
  ContractReferenceRelation,
  ContractValueObject,
} from '@prisma-next/contract/types';
import type { MongoIndexKeyDirection, MongoStorageIndex } from '@prisma-next/mongo-contract';
import type { ParsePslDocumentResult, PslField, PslModel } from '@prisma-next/psl-parser';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { deriveJsonSchema, derivePolymorphicJsonSchema } from './derive-json-schema';
import {
  getAttribute,
  getMapName,
  getNamedArgument,
  getPositionalArgument,
  lowerFirst,
  parseIndexFieldList,
  parseQuotedStringLiteral,
  parseRelationAttribute,
} from './psl-helpers';

export interface InterpretPslDocumentToMongoContractInput {
  readonly document: ParsePslDocumentResult;
  readonly scalarTypeDescriptors: ReadonlyMap<string, string>;
}

interface FieldMappings {
  readonly pslNameToMapped: Map<string, string>;
}

interface FkRelation {
  readonly declaringModel: string;
  readonly fieldName: string;
  readonly targetModel: string;
  readonly relationName?: string;
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
}

function fkRelationPairKey(declaringModel: string, targetModel: string): string {
  return `${declaringModel}::${targetModel}`;
}

function resolveFieldMappings(model: PslModel): FieldMappings {
  const pslNameToMapped = new Map<string, string>();
  for (const field of model.fields) {
    const mapped = getMapName(field.attributes) ?? field.name;
    pslNameToMapped.set(field.name, mapped);
  }
  return { pslNameToMapped };
}

function resolveCollectionName(model: PslModel): string {
  return getMapName(model.attributes) ?? lowerFirst(model.name);
}

interface MongoModelEntry {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractReferenceRelation>;
  readonly storage: { readonly collection: string };
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, { readonly value: string }>;
  readonly base?: string;
}

type DiscriminatorDeclaration = { readonly fieldName: string; readonly span: PslModel['span'] };
type BaseDeclaration = {
  readonly baseName: string;
  readonly value: string;
  readonly collectionName: string;
  readonly span: PslModel['span'];
};

function collectPolymorphismDeclarations(
  document: ParsePslDocumentResult,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): {
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
} {
  const discriminatorDeclarations = new Map<string, DiscriminatorDeclaration>();
  const baseDeclarations = new Map<string, BaseDeclaration>();

  for (const pslModel of document.ast.models) {
    for (const attr of pslModel.attributes) {
      if (attr.name === 'discriminator') {
        const fieldName = getPositionalArgument(attr);
        if (!fieldName) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${pslModel.name}" @@discriminator requires a field name argument`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const discField = pslModel.fields.find((f) => f.name === fieldName);
        if (discField && discField.typeName !== 'String') {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Discriminator field "${fieldName}" on model "${pslModel.name}" must be of type String, but is "${discField.typeName}"`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        discriminatorDeclarations.set(pslModel.name, { fieldName, span: attr.span });
      }
      if (attr.name === 'base') {
        const baseName = getPositionalArgument(attr, 0);
        const rawValue = getPositionalArgument(attr, 1);
        if (!baseName || !rawValue) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${pslModel.name}" @@base requires two arguments: base model name and discriminator value`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const value = parseQuotedStringLiteral(rawValue);
        if (value === undefined) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${pslModel.name}" @@base discriminator value must be a quoted string literal`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const collectionName = resolveCollectionName(pslModel);
        baseDeclarations.set(pslModel.name, { baseName, value, collectionName, span: attr.span });
      }
    }
  }

  return { discriminatorDeclarations, baseDeclarations };
}

function resolvePolymorphism(input: {
  models: Record<string, MongoModelEntry>;
  roots: Record<string, string>;
  collections: Record<string, Record<string, unknown>>;
  document: ParsePslDocumentResult;
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
  modelNames: ReadonlySet<string>;
  sourceId: string;
}): {
  models: Record<string, MongoModelEntry>;
  roots: Record<string, string>;
  collections: Record<string, Record<string, unknown>>;
  diagnostics: ContractSourceDiagnostic[];
} {
  const { discriminatorDeclarations, baseDeclarations, modelNames, sourceId, document } = input;
  let patched = input.models;
  let roots = input.roots;
  let collections = input.collections;
  const diagnostics: ContractSourceDiagnostic[] = [];

  for (const [modelName, decl] of discriminatorDeclarations) {
    if (baseDeclarations.has(modelName)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_AND_BASE',
        message: `Model "${modelName}" cannot have both @@discriminator and @@base`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    const model = patched[modelName];
    if (!model) continue;

    if (!Object.hasOwn(model.fields, decl.fieldName)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_FIELD_NOT_FOUND',
        message: `Discriminator field "${decl.fieldName}" is not a field on model "${modelName}"`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    const variants: Record<string, { readonly value: string }> = {};
    for (const [variantName, baseDecl] of baseDeclarations) {
      if (baseDecl.baseName !== modelName) continue;
      variants[variantName] = { value: baseDecl.value };
    }

    if (Object.keys(variants).length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_DISCRIMINATOR',
        message: `Model "${modelName}" has @@discriminator but no variant models declare @@base(${modelName}, ...)`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    patched = {
      ...patched,
      [modelName]: { ...model, discriminator: { field: decl.fieldName }, variants },
    };
  }

  for (const [variantName, baseDecl] of baseDeclarations) {
    if (!modelNames.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_BASE_TARGET_NOT_FOUND',
        message: `Model "${variantName}" @@base references non-existent model "${baseDecl.baseName}"`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (!discriminatorDeclarations.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BASE',
        message: `Model "${variantName}" declares @@base(${baseDecl.baseName}, ...) but "${baseDecl.baseName}" has no @@discriminator`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (discriminatorDeclarations.has(variantName)) {
      continue;
    }

    const baseModel = patched[baseDecl.baseName];
    const variantPslModel = document.ast.models.find((m) => m.name === variantName);
    if (!variantPslModel) continue;
    const hasExplicitMap = getMapName(variantPslModel.attributes) !== undefined;

    if (hasExplicitMap && baseModel && baseDecl.collectionName !== baseModel.storage.collection) {
      diagnostics.push({
        code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION',
        message: `Mongo variant "${variantName}" cannot use a different collection than its base "${baseDecl.baseName}". Mongo only supports single-collection polymorphism.`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    const baseCollection = baseModel?.storage.collection ?? baseDecl.collectionName;
    const variantModel = patched[variantName];
    if (variantModel) {
      patched = {
        ...patched,
        [variantName]: {
          ...variantModel,
          base: baseDecl.baseName,
          storage: { collection: baseCollection },
        },
      };
    }

    const variantCollectionName = resolveCollectionName(variantPslModel);
    if (roots[variantCollectionName] === variantName) {
      if (variantCollectionName === baseCollection && baseModel) {
        roots = { ...roots, [variantCollectionName]: baseDecl.baseName };
      } else {
        roots = Object.fromEntries(
          Object.entries(roots).filter(([key]) => key !== variantCollectionName),
        );
      }
    }

    if (variantCollectionName !== baseCollection) {
      const variantColl = collections[variantCollectionName];
      const variantIndexes = (variantColl?.['indexes'] ?? []) as MongoStorageIndex[];
      if (variantIndexes.length > 0) {
        const baseColl = collections[baseCollection];
        if (baseColl) {
          const baseIndexes = (baseColl['indexes'] ?? []) as MongoStorageIndex[];
          baseColl['indexes'] = [...baseIndexes, ...variantIndexes];
        }
      }
      collections = Object.fromEntries(
        Object.entries(collections).filter(([key]) => key !== variantCollectionName),
      );
    }
  }

  return { models: patched, roots, collections, diagnostics };
}

function parseIndexDirection(raw: string | undefined): MongoIndexKeyDirection {
  if (!raw) return 1;
  const stripped = raw.replace(/^["']/, '').replace(/["']$/, '');
  const num = Number(stripped);
  if (num === 1 || num === -1) return num;
  if (['text', '2dsphere', '2d', 'hashed'].includes(stripped))
    return stripped as MongoIndexKeyDirection;
  return 1;
}

function parseNumericArg(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseBooleanArg(raw: string | undefined): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseJsonArg(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const stripped = raw.replace(/^["']/, '').replace(/["']$/, '').replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not valid JSON
  }
  return undefined;
}

function parseCollation(
  attr: import('@prisma-next/psl-parser').PslAttribute,
): Record<string, unknown> | null | undefined {
  const locale = stripQuotesHelper(getNamedArgument(attr, 'collationLocale'));
  if (!locale) {
    const hasAnyCollationArg =
      getNamedArgument(attr, 'collationStrength') != null ||
      getNamedArgument(attr, 'collationCaseLevel') != null ||
      getNamedArgument(attr, 'collationCaseFirst') != null ||
      getNamedArgument(attr, 'collationNumericOrdering') != null ||
      getNamedArgument(attr, 'collationAlternate') != null ||
      getNamedArgument(attr, 'collationMaxVariable') != null ||
      getNamedArgument(attr, 'collationBackwards') != null ||
      getNamedArgument(attr, 'collationNormalization') != null;
    return hasAnyCollationArg ? null : undefined;
  }

  const collation: Record<string, unknown> = { locale };
  const strength = parseNumericArg(getNamedArgument(attr, 'collationStrength'));
  if (strength != null) collation['strength'] = strength;
  const caseLevel = parseBooleanArg(getNamedArgument(attr, 'collationCaseLevel'));
  if (caseLevel != null) collation['caseLevel'] = caseLevel;
  const caseFirst = stripQuotesHelper(getNamedArgument(attr, 'collationCaseFirst'));
  if (caseFirst != null) collation['caseFirst'] = caseFirst;
  const numericOrdering = parseBooleanArg(getNamedArgument(attr, 'collationNumericOrdering'));
  if (numericOrdering != null) collation['numericOrdering'] = numericOrdering;
  const alternate = stripQuotesHelper(getNamedArgument(attr, 'collationAlternate'));
  if (alternate != null) collation['alternate'] = alternate;
  const maxVariable = stripQuotesHelper(getNamedArgument(attr, 'collationMaxVariable'));
  if (maxVariable != null) collation['maxVariable'] = maxVariable;
  const backwards = parseBooleanArg(getNamedArgument(attr, 'collationBackwards'));
  if (backwards != null) collation['backwards'] = backwards;
  const normalization = parseBooleanArg(getNamedArgument(attr, 'collationNormalization'));
  if (normalization != null) collation['normalization'] = normalization;
  return collation;
}

function stripQuotesHelper(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^["']/, '').replace(/["']$/, '');
}

function parseProjectionList(
  raw: string | undefined,
  value: 0 | 1,
): Record<string, 0 | 1> | undefined {
  if (!raw) return undefined;
  const stripped = raw.replace(/^["']/, '').replace(/["']$/, '');
  const inner = stripped.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.length === 0) return undefined;
  const fields = inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const result: Record<string, 0 | 1> = {};
  for (const f of fields) {
    result[f] = value;
  }
  return result;
}

function collectIndexes(
  pslModel: PslModel,
  fieldMappings: FieldMappings,
  modelNames: ReadonlySet<string>,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): MongoStorageIndex[] {
  const indexes: MongoStorageIndex[] = [];
  let textIndexCount = 0;

  for (const field of pslModel.fields) {
    if (modelNames.has(field.typeName)) continue;
    const uniqueAttr = getAttribute(field.attributes, 'unique');
    if (!uniqueAttr) continue;
    const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
    indexes.push({
      keys: [{ field: mappedName, direction: 1 }],
      unique: true,
    });
  }

  for (const attr of pslModel.attributes) {
    const isIndex = attr.name === 'index';
    const isUnique = attr.name === 'unique';
    const isTextIndex = attr.name === 'textIndex';
    if (!isIndex && !isUnique && !isTextIndex) continue;

    const fieldsArg = getPositionalArgument(attr, 0);
    if (!fieldsArg) continue;
    const parsedFields = parseIndexFieldList(fieldsArg);
    if (parsedFields.length === 0) continue;

    const hasWildcard = parsedFields.some((f) => f.isWildcard);
    const wildcardCount = parsedFields.filter((f) => f.isWildcard).length;

    if (wildcardCount > 1) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'An index can contain at most one wildcard() field',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    if (isUnique && hasWildcard) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'Unique indexes cannot use wildcard() fields',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    if (isTextIndex) {
      textIndexCount++;
      if (textIndexCount > 1) {
        diagnostics.push({
          code: 'PSL_INVALID_INDEX',
          message: `Only one @@textIndex is allowed per collection (model "${pslModel.name}")`,
          sourceId,
          span: attr.span,
        });
        continue;
      }

      if (hasWildcard) {
        diagnostics.push({
          code: 'PSL_INVALID_INDEX',
          message:
            'wildcard() fields cannot be combined with type: hashed/2dsphere/2d or @@textIndex',
          sourceId,
          span: attr.span,
        });
        continue;
      }
    }

    const typeArg = getNamedArgument(attr, 'type');
    const defaultDirection: MongoIndexKeyDirection = isTextIndex
      ? 'text'
      : parseIndexDirection(typeArg);

    if (
      hasWildcard &&
      typeof defaultDirection === 'string' &&
      ['hashed', '2dsphere', '2d'].includes(defaultDirection)
    ) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: `wildcard() fields cannot be combined with type: ${defaultDirection}`,
        sourceId,
        span: attr.span,
      });
      continue;
    }

    if (defaultDirection === 'hashed' && parsedFields.length > 1) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'Hashed indexes must have exactly one field',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    const keys = parsedFields.map((pf) => {
      const mappedName = pf.isWildcard
        ? pf.name.replace(/^(.+)\.\$\*\*$/, (_, prefix: string) => {
            const mapped = fieldMappings.pslNameToMapped.get(prefix);
            return mapped ? `${mapped}.$**` : `${prefix}.$**`;
          })
        : (fieldMappings.pslNameToMapped.get(pf.name) ?? pf.name);
      const direction: MongoIndexKeyDirection =
        pf.direction != null ? (pf.direction as MongoIndexKeyDirection) : defaultDirection;
      return { field: mappedName, direction };
    });

    const unique = isUnique ? true : undefined;
    const sparse = isTextIndex ? undefined : parseBooleanArg(getNamedArgument(attr, 'sparse'));
    const expireAfterSeconds = isTextIndex
      ? undefined
      : parseNumericArg(getNamedArgument(attr, 'expireAfterSeconds'));

    if (hasWildcard && expireAfterSeconds != null) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'expireAfterSeconds cannot be combined with wildcard() fields',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    const partialFilterExpression = parseJsonArg(getNamedArgument(attr, 'filter'));

    const includeArg = getNamedArgument(attr, 'include');
    const excludeArg = getNamedArgument(attr, 'exclude');

    if (includeArg != null && excludeArg != null) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'Cannot specify both include and exclude on the same index',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    if ((includeArg != null || excludeArg != null) && !hasWildcard) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message:
          'include/exclude options are only valid when the index contains a wildcard() field',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    const wildcardProjection =
      includeArg != null
        ? parseProjectionList(includeArg, 1)
        : excludeArg != null
          ? parseProjectionList(excludeArg, 0)
          : undefined;

    const collation = parseCollation(attr);
    if (collation === null) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: 'collationLocale is required when using collation options',
        sourceId,
        span: attr.span,
      });
      continue;
    }

    const rawWeights = parseJsonArg(getNamedArgument(attr, 'weights'));
    let weights: Record<string, number> | undefined;
    if (rawWeights) {
      weights = {};
      for (const [k, v] of Object.entries(rawWeights)) {
        if (typeof v === 'number') weights[k] = v;
      }
    }

    const rawDefaultLang = isTextIndex
      ? getNamedArgument(attr, 'language')
      : getNamedArgument(attr, 'default_language');
    const default_language = stripQuotesHelper(rawDefaultLang);

    const rawLangOverride = getNamedArgument(attr, 'languageOverride');
    const language_override = stripQuotesHelper(rawLangOverride);

    const index: MongoStorageIndex = {
      keys,
      ...(unique != null && { unique }),
      ...(sparse != null && { sparse }),
      ...(expireAfterSeconds != null && { expireAfterSeconds }),
      ...(partialFilterExpression != null && { partialFilterExpression }),
      ...(wildcardProjection != null && { wildcardProjection }),
      ...(collation != null && { collation }),
      ...(weights != null && { weights }),
      ...(default_language != null && { default_language }),
      ...(language_override != null && { language_override }),
    };

    indexes.push(index);
  }

  return indexes;
}

function isRelationField(field: PslField, modelNames: ReadonlySet<string>): boolean {
  return modelNames.has(field.typeName);
}

function resolveFieldCodecId(
  field: PslField,
  scalarTypeDescriptors: ReadonlyMap<string, string>,
): string | undefined {
  return scalarTypeDescriptors.get(field.typeName);
}

function resolveNonRelationField(
  field: PslField,
  ownerName: string,
  compositeTypeNames: ReadonlySet<string>,
  scalarTypeDescriptors: ReadonlyMap<string, string>,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): ContractField | undefined {
  if (compositeTypeNames.has(field.typeName)) {
    const result: ContractField = {
      type: { kind: 'valueObject', name: field.typeName },
      nullable: field.optional,
    };
    return field.list ? { ...result, many: true } : result;
  }

  const codecId = resolveFieldCodecId(field, scalarTypeDescriptors);
  if (!codecId) {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_TYPE',
      message: `Field "${ownerName}.${field.name}" type "${field.typeName}" is not supported in Mongo PSL interpreter`,
      sourceId,
      span: field.span,
    });
    return undefined;
  }

  const result: ContractField = {
    type: { kind: 'scalar', codecId },
    nullable: field.optional,
  };
  return field.list ? { ...result, many: true } : result;
}

export function interpretPslDocumentToMongoContract(
  input: InterpretPslDocumentToMongoContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { document, scalarTypeDescriptors } = input;
  const sourceId = document.ast.sourceId;
  const diagnostics: ContractSourceDiagnostic[] = [];
  const modelNames = new Set(document.ast.models.map((m) => m.name));
  const compositeTypeNames = new Set(document.ast.compositeTypes.map((ct) => ct.name));

  const models: Record<string, MongoModelEntry> = {};
  const collections: Record<string, Record<string, unknown>> = {};
  const roots: Record<string, string> = {};
  const allFkRelations: FkRelation[] = [];

  interface BackrelationCandidate {
    readonly modelName: string;
    readonly fieldName: string;
    readonly targetModelName: string;
    readonly relationName?: string;
    readonly cardinality: '1:1' | '1:N';
    readonly field: PslField;
  }
  const backrelationCandidates: BackrelationCandidate[] = [];

  for (const pslModel of document.ast.models) {
    const collectionName = resolveCollectionName(pslModel);
    const fieldMappings = resolveFieldMappings(pslModel);

    const fields: Record<string, ContractField> = {};
    const relations: Record<string, ContractReferenceRelation> = {};

    for (const field of pslModel.fields) {
      if (isRelationField(field, modelNames)) {
        const relation = parseRelationAttribute(field.attributes);

        if (field.list || !(relation?.fields && relation?.references)) {
          backrelationCandidates.push({
            modelName: pslModel.name,
            fieldName: field.name,
            targetModelName: field.typeName,
            ...(relation?.relationName !== undefined
              ? { relationName: relation.relationName }
              : {}),
            cardinality: field.list ? '1:N' : '1:1',
            field,
          });
          continue;
        }

        if (relation?.fields && relation?.references) {
          const localMapped = relation.fields.map((f) => fieldMappings.pslNameToMapped.get(f) ?? f);

          const targetModel = document.ast.models.find((m) => m.name === field.typeName);
          const targetFieldMappings = targetModel ? resolveFieldMappings(targetModel) : undefined;
          const targetMapped = relation.references.map(
            (f) => targetFieldMappings?.pslNameToMapped.get(f) ?? f,
          );

          relations[field.name] = {
            to: field.typeName,
            cardinality: 'N:1' as const,
            on: {
              localFields: localMapped,
              targetFields: targetMapped,
            },
          };

          allFkRelations.push({
            declaringModel: pslModel.name,
            fieldName: field.name,
            targetModel: field.typeName,
            ...(relation.relationName !== undefined ? { relationName: relation.relationName } : {}),
            localFields: localMapped,
            targetFields: targetMapped,
          });
        }
        continue;
      }

      const resolved = resolveNonRelationField(
        field,
        pslModel.name,
        compositeTypeNames,
        scalarTypeDescriptors,
        sourceId,
        diagnostics,
      );
      if (!resolved) continue;

      const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
      fields[mappedName] = resolved;
    }

    const isVariantModel = pslModel.attributes.some((attr) => attr.name === 'base');
    const hasIdField = pslModel.fields.some((f) => getAttribute(f.attributes, 'id') !== undefined);
    if (!hasIdField && !isVariantModel) {
      diagnostics.push({
        code: 'PSL_MISSING_ID_FIELD',
        message: `Model "${pslModel.name}" has no field with @id attribute. Every model must have exactly one @id field.`,
        sourceId,
      });
    }

    models[pslModel.name] = { fields, relations, storage: { collection: collectionName } };
    const modelIndexes = collectIndexes(pslModel, fieldMappings, modelNames, sourceId, diagnostics);
    collections[collectionName] = modelIndexes.length > 0 ? { indexes: modelIndexes } : {};
    roots[collectionName] = pslModel.name;
  }

  const valueObjects: Record<string, ContractValueObject> = {};
  for (const compositeType of document.ast.compositeTypes) {
    const fields: Record<string, ContractField> = {};
    for (const field of compositeType.fields) {
      const resolved = resolveNonRelationField(
        field,
        compositeType.name,
        compositeTypeNames,
        scalarTypeDescriptors,
        sourceId,
        diagnostics,
      );
      if (!resolved) continue;
      fields[field.name] = resolved;
    }
    valueObjects[compositeType.name] = { fields };
  }

  const fkRelationsByPair = new Map<string, FkRelation[]>();
  for (const fk of allFkRelations) {
    const key = fkRelationPairKey(fk.declaringModel, fk.targetModel);
    const existing = fkRelationsByPair.get(key);
    if (existing) {
      existing.push(fk);
    } else {
      fkRelationsByPair.set(key, [fk]);
    }
  }

  for (const candidate of backrelationCandidates) {
    const pairKey = fkRelationPairKey(candidate.targetModelName, candidate.modelName);
    const pairMatches = fkRelationsByPair.get(pairKey) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((r) => r.relationName === candidate.relationName)
      : [...pairMatches];

    if (matches.length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" has no matching FK-side relation on model "${candidate.targetModelName}". Add @relation(fields: [...], references: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
        sourceId,
        span: candidate.field.span,
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" matches multiple FK-side relations on model "${candidate.targetModelName}". Add @relation("...") to both sides to disambiguate.`,
        sourceId,
        span: candidate.field.span,
      });
      continue;
    }

    const fk = matches[0];
    if (!fk) continue;
    const modelEntry = models[candidate.modelName];
    if (!modelEntry) continue;
    modelEntry.relations[candidate.fieldName] = {
      to: candidate.targetModelName,
      cardinality: candidate.cardinality,
      on: {
        localFields: fk.targetFields,
        targetFields: fk.localFields,
      },
    };
  }

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    document,
    sourceId,
    diagnostics,
  );
  const polyResult = resolvePolymorphism({
    models,
    roots,
    collections,
    document,
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    sourceId,
  });

  if (diagnostics.length > 0 || polyResult.diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to Mongo contract interpretation failed',
      diagnostics: [...diagnostics, ...polyResult.diagnostics],
    });
  }

  const resolvedModels = polyResult.models;
  const resolvedCollections = polyResult.collections;

  for (const [, modelEntry] of Object.entries(resolvedModels)) {
    if (modelEntry.base) continue;

    const collectionName = modelEntry.storage.collection;
    const coll = resolvedCollections[collectionName];
    if (!coll) continue;

    if (modelEntry.discriminator && modelEntry.variants) {
      const variantEntries = Object.entries(modelEntry.variants).map(
        ([variantName, { value }]) => ({
          discriminatorValue: value,
          fields: resolvedModels[variantName]?.fields ?? {},
        }),
      );
      coll['validator'] = derivePolymorphicJsonSchema(
        modelEntry.fields,
        modelEntry.discriminator.field,
        variantEntries,
        valueObjects,
      );
    } else {
      coll['validator'] = deriveJsonSchema(modelEntry.fields, valueObjects);
    }
  }

  const target = 'mongo';
  const targetFamily = 'mongo';
  const storageWithoutHash = { collections: resolvedCollections };
  const storageHash = computeStorageHash({ target, targetFamily, storage: storageWithoutHash });
  const capabilities: Record<string, Record<string, boolean>> = {};

  return ok({
    targetFamily,
    target,
    roots: polyResult.roots,
    models: polyResult.models,
    ...(Object.keys(valueObjects).length > 0 ? { valueObjects } : {}),
    storage: { ...storageWithoutHash, storageHash },
    extensionPacks: {},
    capabilities,
    profileHash: computeProfileHash({ target, targetFamily, capabilities }),
    meta: {},
  });
}
