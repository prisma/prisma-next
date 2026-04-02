import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ParsePslDocumentResult, PslField, PslModel } from '@prisma-next/psl-parser';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { getMapName, lowerFirst, parseRelationAttribute } from './psl-helpers';

export interface InterpretPslDocumentToMongoContractIRInput {
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
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
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

export function interpretPslDocumentToMongoContractIR(
  input: InterpretPslDocumentToMongoContractIRInput,
): Result<ContractIR, ContractSourceDiagnostics> {
  const { document, scalarTypeDescriptors } = input;
  const sourceId = document.ast.sourceId;
  const diagnostics: ContractSourceDiagnostic[] = [];
  const modelNames = new Set(document.ast.models.map((m) => m.name));

  const models: Record<string, unknown> = {};
  const collections: Record<string, Record<string, unknown>> = {};
  const roots: Record<string, string> = {};
  const allFkRelations: FkRelation[] = [];

  interface BackrelationCandidate {
    readonly modelName: string;
    readonly fieldName: string;
    readonly targetModelName: string;
  }
  const backrelationCandidates: BackrelationCandidate[] = [];

  for (const pslModel of document.ast.models) {
    const collectionName = resolveCollectionName(pslModel);
    const fieldMappings = resolveFieldMappings(pslModel);

    const fields: Record<string, { codecId: string; nullable: boolean }> = {};
    const relations: Record<string, unknown> = {};

    for (const field of pslModel.fields) {
      if (isRelationField(field, modelNames)) {
        if (field.list) {
          backrelationCandidates.push({
            modelName: pslModel.name,
            fieldName: field.name,
            targetModelName: field.typeName,
          });
          continue;
        }

        const relation = parseRelationAttribute(field.attributes);
        if (relation) {
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
            localFields: localMapped,
            targetFields: targetMapped,
          });
        }
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

    models[pslModel.name] = { fields, relations, storage: { collection: collectionName } };
    collections[collectionName] = {};
    roots[collectionName] = pslModel.name;
  }

  for (const candidate of backrelationCandidates) {
    const fk = allFkRelations.find(
      (r) =>
        r.declaringModel === candidate.targetModelName && r.targetModel === candidate.modelName,
    );
    if (!fk) continue;

    const modelEntry = models[candidate.modelName] as {
      relations: Record<string, unknown>;
    };
    modelEntry.relations[candidate.fieldName] = {
      to: candidate.targetModelName,
      cardinality: '1:N' as const,
      on: {
        localFields: fk.targetFields,
        targetFields: fk.localFields,
      },
    };
  }

  if (diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to Mongo Contract IR interpretation failed',
      diagnostics,
    });
  }

  return ok({
    schemaVersion: '1',
    targetFamily: 'mongo',
    target: 'mongo',
    roots,
    models,
    storage: { collections },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  });
}
