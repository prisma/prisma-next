import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import type {
  Contract,
  ContractField,
  ContractReferenceRelation,
} from '@prisma-next/contract/types';
import type { ParsePslDocumentResult, PslField, PslModel } from '@prisma-next/psl-parser';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { getAttribute, getMapName, lowerFirst, parseRelationAttribute } from './psl-helpers';

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

function isRelationField(field: PslField, modelNames: ReadonlySet<string>): boolean {
  return modelNames.has(field.typeName);
}

function resolveFieldCodecId(
  field: PslField,
  scalarTypeDescriptors: ReadonlyMap<string, string>,
): string | undefined {
  return scalarTypeDescriptors.get(field.typeName);
}

export function interpretPslDocumentToMongoContract(
  input: InterpretPslDocumentToMongoContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { document, scalarTypeDescriptors } = input;
  const sourceId = document.ast.sourceId;
  const diagnostics: ContractSourceDiagnostic[] = [];
  const modelNames = new Set(document.ast.models.map((m) => m.name));

  interface MutableDomainModel {
    readonly fields: Record<string, ContractField>;
    readonly relations: Record<string, ContractReferenceRelation>;
    readonly storage: { readonly collection: string };
  }

  const models: Record<string, MutableDomainModel> = {};
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

      if (field.list) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_LIST_FIELD',
          message: `Field "${pslModel.name}.${field.name}" is a scalar list (${field.typeName}[]). Scalar list fields are not yet supported in the Mongo interpreter.`,
          sourceId,
          span: field.span,
        });
        continue;
      }

      const codecId = resolveFieldCodecId(field, scalarTypeDescriptors);
      if (!codecId) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: `Field "${pslModel.name}.${field.name}" type "${field.typeName}" is not supported in Mongo PSL interpreter`,
          sourceId,
          span: field.span,
        });
        continue;
      }

      const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
      fields[mappedName] = {
        codecId,
        nullable: field.optional,
      };
    }

    const hasIdField = pslModel.fields.some((f) => getAttribute(f.attributes, 'id') !== undefined);
    if (!hasIdField) {
      diagnostics.push({
        code: 'PSL_MISSING_ID_FIELD',
        message: `Model "${pslModel.name}" has no field with @id attribute. Every model must have exactly one @id field.`,
        sourceId,
      });
    }

    models[pslModel.name] = { fields, relations, storage: { collection: collectionName } };
    collections[collectionName] = {};
    roots[collectionName] = pslModel.name;
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

  if (diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to Mongo contract interpretation failed',
      diagnostics,
    });
  }

  const target = 'mongo';
  const targetFamily = 'mongo';
  const storageWithoutHash = { collections };
  const storageHash = computeStorageHash({ target, targetFamily, storage: storageWithoutHash });
  const capabilities: Record<string, Record<string, boolean>> = {};

  return ok({
    targetFamily,
    target,
    roots,
    models,
    storage: { ...storageWithoutHash, storageHash },
    extensionPacks: {},
    capabilities,
    profileHash: computeProfileHash({ target, targetFamily, capabilities }),
    meta: {},
  });
}
