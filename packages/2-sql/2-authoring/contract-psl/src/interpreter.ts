import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import type {
  AuthoringContributions,
  ExtensionPackRef,
  TargetPackRef,
} from '@prisma-next/contract/framework-components';
import { instantiateAuthoringTypeConstructor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ParsePslDocumentResult,
  PslAttribute,
  PslField,
  PslSpan,
} from '@prisma-next/psl-parser';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  buildSqlContractFromSemanticDefinition,
  type SqlSemanticForeignKeyNode,
  type SqlSemanticIndexNode,
  type SqlSemanticModelNode,
  type SqlSemanticUniqueConstraintNode,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import type {
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from './default-function-registry';
import {
  getAttribute,
  mapFieldNamesToColumns,
  parseAttributeFieldList,
  parseConstraintMapArgument,
  parseMapName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  getAuthoringTypeConstructor,
  parsePgvectorLength,
  resolveDbNativeTypeAttribute,
  toNamedTypeFieldDescriptor,
} from './psl-column-resolution';
import { buildModelMappings, collectResolvedFields } from './psl-field-resolution';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
  parseRelationAttribute,
  validateNavigationListFieldAttributes,
} from './psl-relation-resolution';

export interface InterpretPslDocumentToSqlContractIRInput {
  readonly document: ParsePslDocumentResult;
  readonly target: TargetPackRef<'sql', 'postgres'>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensionPacks?: readonly string[];
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', 'postgres'>[];
  readonly controlMutationDefaults?: ControlMutationDefaults;
  readonly authoringContributions?: AuthoringContributions;
}

function buildComposedExtensionPackRefs(
  target: TargetPackRef<'sql', 'postgres'>,
  extensionIds: readonly string[],
  extensionPackRefs: readonly ExtensionPackRef<'sql', 'postgres'>[] = [],
): Record<string, ExtensionPackRef<'sql', 'postgres'>> | undefined {
  if (extensionIds.length === 0) {
    return undefined;
  }

  const extensionPackRefById = new Map(extensionPackRefs.map((packRef) => [packRef.id, packRef]));

  return Object.fromEntries(
    extensionIds.map((extensionId) => [
      extensionId,
      extensionPackRefById.get(extensionId) ??
        ({
          kind: 'extension',
          id: extensionId,
          familyId: target.familyId,
          targetId: target.targetId,
          version: '0.0.1',
        } satisfies ExtensionPackRef<'sql', 'postgres'>),
    ]),
  );
}

function hasSameSpan(a: PslSpan, b: ContractSourceDiagnosticSpan): boolean {
  return (
    a.start.offset === b.start.offset &&
    a.end.offset === b.end.offset &&
    a.start.line === b.start.line &&
    a.end.line === b.end.line
  );
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function mapParserDiagnostics(document: ParsePslDocumentResult): ContractSourceDiagnostic[] {
  return document.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId: diagnostic.sourceId,
    span: diagnostic.span,
  }));
}

export function interpretPslDocumentToSqlContractIR(
  input: InterpretPslDocumentToSqlContractIRInput,
): Result<ContractIR, ContractSourceDiagnostics> {
  const sourceId = input.document.ast.sourceId;
  if (!input.target) {
    return notOk({
      summary: 'PSL to SQL Contract IR normalization failed',
      diagnostics: [
        {
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires an explicit target context from composition.',
          sourceId,
        },
      ],
    });
  }
  if (!input.scalarTypeDescriptors) {
    return notOk({
      summary: 'PSL to SQL Contract IR normalization failed',
      diagnostics: [
        {
          code: 'PSL_SCALAR_TYPE_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires composed scalar type descriptors.',
          sourceId,
        },
      ],
    });
  }

  const diagnostics: ContractSourceDiagnostic[] = mapParserDiagnostics(input.document);
  const modelNames = new Set(input.document.ast.models.map((model) => model.name));
  const composedExtensions = new Set(input.composedExtensionPacks ?? []);
  const defaultFunctionRegistry =
    input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map<string, never>();
  const generatorDescriptors = input.controlMutationDefaults?.generatorDescriptors ?? [];
  const generatorDescriptorById = new Map<string, MutationDefaultGeneratorDescriptor>();
  for (const descriptor of generatorDescriptors) {
    generatorDescriptorById.set(descriptor.id, descriptor);
  }

  const storageTypes: Record<string, StorageTypeInstance> = {};
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();
  const namedTypeDescriptors = new Map<string, ColumnDescriptor>();
  const namedTypeBaseTypes = new Map<string, string>();
  const enumTypeConstructor = getAuthoringTypeConstructor(input.authoringContributions, ['enum']);
  const pgvectorVectorConstructor = getAuthoringTypeConstructor(input.authoringContributions, [
    'pgvector',
    'vector',
  ]);

  for (const enumDeclaration of input.document.ast.enums) {
    const nativeType = parseMapName({
      attribute: getAttribute(enumDeclaration.attributes, 'map'),
      defaultValue: enumDeclaration.name,
      sourceId,
      diagnostics,
      entityLabel: `Enum "${enumDeclaration.name}"`,
      span: enumDeclaration.span,
    });
    const enumStorageType = enumTypeConstructor
      ? instantiateAuthoringTypeConstructor(enumTypeConstructor, [
          nativeType,
          enumDeclaration.values.map((value) => value.name),
        ])
      : {
          codecId: 'pg/enum@1',
          nativeType,
          typeParams: { values: enumDeclaration.values.map((value) => value.name) },
        };
    const descriptor: ColumnDescriptor = {
      codecId: enumStorageType.codecId,
      nativeType: enumStorageType.nativeType,
      typeRef: enumDeclaration.name,
    };
    enumTypeDescriptors.set(enumDeclaration.name, descriptor);
    storageTypes[enumDeclaration.name] = {
      codecId: enumStorageType.codecId,
      nativeType: enumStorageType.nativeType,
      typeParams: enumStorageType.typeParams ?? {
        values: enumDeclaration.values.map((value) => value.name),
      },
    };
  }

  for (const declaration of input.document.ast.types?.declarations ?? []) {
    const baseDescriptor =
      enumTypeDescriptors.get(declaration.baseType) ??
      input.scalarTypeDescriptors.get(declaration.baseType);
    if (!baseDescriptor) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" references unsupported base type "${declaration.baseType}"`,
        sourceId,
        span: declaration.span,
      });
      continue;
    }
    namedTypeBaseTypes.set(declaration.name, declaration.baseType);

    const pgvectorAttribute = getAttribute(declaration.attributes, 'pgvector.column');
    const dbNativeTypeAttribute = declaration.attributes.find((attribute) =>
      attribute.name.startsWith('db.'),
    );
    const unsupportedNamedTypeAttribute = declaration.attributes.find(
      (attribute) => attribute.name !== 'pgvector.column' && !attribute.name.startsWith('db.'),
    );
    if (unsupportedNamedTypeAttribute) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: `Named type "${declaration.name}" uses unsupported attribute "${unsupportedNamedTypeAttribute.name}"`,
        sourceId,
        span: unsupportedNamedTypeAttribute.span,
      });
      continue;
    }

    if (pgvectorAttribute && dbNativeTypeAttribute) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: `Named type "${declaration.name}" cannot combine @pgvector.column with @${dbNativeTypeAttribute.name}.`,
        sourceId,
        span: dbNativeTypeAttribute.span,
      });
      continue;
    }

    if (pgvectorAttribute) {
      if (!composedExtensions.has('pgvector')) {
        diagnostics.push({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message:
            'Attribute "@pgvector.column" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensionPacks in prisma-next.config.ts.',
          sourceId,
          span: pgvectorAttribute.span,
        });
        continue;
      }
      if (declaration.baseType !== 'Bytes') {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Named type "${declaration.name}" uses @pgvector.column on unsupported base type "${declaration.baseType}"`,
          sourceId,
          span: pgvectorAttribute.span,
        });
        continue;
      }
      const length = parsePgvectorLength({
        attribute: pgvectorAttribute,
        diagnostics,
        sourceId,
      });
      if (length === undefined) {
        continue;
      }
      const pgvectorStorageType = pgvectorVectorConstructor
        ? instantiateAuthoringTypeConstructor(pgvectorVectorConstructor, [length])
        : {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length },
          };
      namedTypeDescriptors.set(
        declaration.name,
        toNamedTypeFieldDescriptor(declaration.name, pgvectorStorageType),
      );
      storageTypes[declaration.name] = {
        codecId: pgvectorStorageType.codecId,
        nativeType: pgvectorStorageType.nativeType,
        typeParams: pgvectorStorageType.typeParams ?? { length },
      };
      continue;
    }

    if (dbNativeTypeAttribute) {
      const descriptor = resolveDbNativeTypeAttribute({
        attribute: dbNativeTypeAttribute,
        baseType: declaration.baseType,
        baseDescriptor,
        diagnostics,
        sourceId,
        entityLabel: `Named type "${declaration.name}"`,
      });
      if (!descriptor) {
        continue;
      }
      namedTypeDescriptors.set(
        declaration.name,
        toNamedTypeFieldDescriptor(declaration.name, descriptor),
      );
      storageTypes[declaration.name] = {
        codecId: descriptor.codecId,
        nativeType: descriptor.nativeType,
        typeParams: descriptor.typeParams ?? {},
      };
      continue;
    }

    const descriptor = toNamedTypeFieldDescriptor(declaration.name, baseDescriptor);
    namedTypeDescriptors.set(declaration.name, descriptor);
    storageTypes[declaration.name] = {
      codecId: baseDescriptor.codecId,
      nativeType: baseDescriptor.nativeType,
      typeParams: {},
    };
  }

  const modelMappings = buildModelMappings(input.document.ast.models, diagnostics, sourceId);
  const semanticModels: SqlSemanticModelNode[] = [];
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const backrelationCandidates: ModelBackrelationCandidate[] = [];

  for (const model of input.document.ast.models) {
    const mapping = modelMappings.get(model.name);
    if (!mapping) {
      continue;
    }
    const tableName = mapping.tableName;
    const resolvedFields = collectResolvedFields(
      model,
      mapping,
      enumTypeDescriptors,
      namedTypeDescriptors,
      namedTypeBaseTypes,
      modelNames,
      composedExtensions,
      input.authoringContributions,
      defaultFunctionRegistry,
      generatorDescriptorById,
      diagnostics,
      sourceId,
      input.scalarTypeDescriptors,
    );

    const primaryKeyFields = resolvedFields.filter((field) => field.isId);
    const primaryKeyColumns = primaryKeyFields.map((field) => field.columnName);
    const primaryKeyName = primaryKeyFields.length === 1 ? primaryKeyFields[0]?.idName : undefined;
    if (primaryKeyColumns.length === 0) {
      diagnostics.push({
        code: 'PSL_MISSING_PRIMARY_KEY',
        message: `Model "${model.name}" must declare at least one @id field for SQL provider`,
        sourceId,
        span: model.span,
      });
    }

    for (const field of model.fields) {
      if (!field.list || !modelNames.has(field.typeName)) {
        continue;
      }
      const attributesValid = validateNavigationListFieldAttributes({
        modelName: model.name,
        field,
        sourceId,
        composedExtensions,
        diagnostics,
      });
      const relationAttribute = getAttribute(field.attributes, 'relation');
      let relationName: string | undefined;
      if (relationAttribute) {
        const parsedRelation = parseRelationAttribute({
          attribute: relationAttribute,
          modelName: model.name,
          fieldName: field.name,
          sourceId,
          diagnostics,
        });
        if (!parsedRelation) {
          continue;
        }
        if (parsedRelation.fields || parsedRelation.references) {
          diagnostics.push({
            code: 'PSL_INVALID_RELATION_ATTRIBUTE',
            message: `Backrelation list field "${model.name}.${field.name}" cannot declare fields/references; define them on the FK-side relation field`,
            sourceId,
            span: relationAttribute.span,
          });
          continue;
        }
        if (parsedRelation.onDelete || parsedRelation.onUpdate) {
          diagnostics.push({
            code: 'PSL_INVALID_RELATION_ATTRIBUTE',
            message: `Backrelation list field "${model.name}.${field.name}" cannot declare onDelete/onUpdate; define referential actions on the FK-side relation field`,
            sourceId,
            span: relationAttribute.span,
          });
          continue;
        }
        relationName = parsedRelation.relationName;
      }
      if (!attributesValid) {
        continue;
      }

      backrelationCandidates.push({
        modelName: model.name,
        tableName,
        field,
        targetModelName: field.typeName,
        ...ifDefined('relationName', relationName),
      });
    }

    const relationAttributes = model.fields
      .map((field) => ({
        field,
        relation: getAttribute(field.attributes, 'relation'),
      }))
      .filter((entry): entry is { field: PslField; relation: PslAttribute } =>
        Boolean(entry.relation),
      );
    const uniqueConstraints: SqlSemanticUniqueConstraintNode[] = resolvedFields
      .filter((field) => field.isUnique)
      .map((field) => ({
        columns: [field.columnName],
        ...ifDefined('name', field.uniqueName),
      }));
    const indexNodes: SqlSemanticIndexNode[] = [];
    const foreignKeyNodes: SqlSemanticForeignKeyNode[] = [];

    for (const modelAttribute of model.attributes) {
      if (modelAttribute.name === 'map') {
        continue;
      }
      if (modelAttribute.name === 'unique' || modelAttribute.name === 'index') {
        const fieldNames = parseAttributeFieldList({
          attribute: modelAttribute,
          sourceId,
          diagnostics,
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          messagePrefix: `Model "${model.name}" @@${modelAttribute.name}`,
        });
        if (!fieldNames) {
          continue;
        }
        const columnNames = mapFieldNamesToColumns({
          modelName: model.name,
          fieldNames,
          mapping,
          sourceId,
          diagnostics,
          span: modelAttribute.span,
          contextLabel: `Model "${model.name}" @@${modelAttribute.name}`,
        });
        if (!columnNames) {
          continue;
        }
        const constraintName = parseConstraintMapArgument({
          attribute: modelAttribute,
          sourceId,
          diagnostics,
          entityLabel: `Model "${model.name}" @@${modelAttribute.name}`,
          span: modelAttribute.span,
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        });
        if (modelAttribute.name === 'unique') {
          uniqueConstraints.push({
            columns: columnNames,
            ...ifDefined('name', constraintName),
          });
        } else {
          indexNodes.push({
            columns: columnNames,
            ...ifDefined('name', constraintName),
          });
        }
        continue;
      }
      if (modelAttribute.name.startsWith('pgvector.') && !composedExtensions.has('pgvector')) {
        diagnostics.push({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: `Attribute "@@${modelAttribute.name}" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensionPacks in prisma-next.config.ts.`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: `Model "${model.name}" uses unsupported attribute "@@${modelAttribute.name}"`,
        sourceId,
        span: modelAttribute.span,
      });
    }

    for (const relationAttribute of relationAttributes) {
      if (relationAttribute.field.list) {
        continue;
      }

      if (!modelNames.has(relationAttribute.field.typeName)) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_TARGET',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${relationAttribute.field.typeName}"`,
          sourceId,
          span: relationAttribute.field.span,
        });
        continue;
      }

      const parsedRelation = parseRelationAttribute({
        attribute: relationAttribute.relation,
        modelName: model.name,
        fieldName: relationAttribute.field.name,
        sourceId,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (!parsedRelation.fields || !parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
          sourceId,
          span: relationAttribute.relation.span,
        });
        continue;
      }

      const targetMapping = modelMappings.get(relationAttribute.field.typeName);
      if (!targetMapping) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_TARGET',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${relationAttribute.field.typeName}"`,
          sourceId,
          span: relationAttribute.field.span,
        });
        continue;
      }

      const localColumns = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames: parsedRelation.fields,
        mapping,
        sourceId,
        diagnostics,
        span: relationAttribute.relation.span,
        contextLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
      });
      if (!localColumns) {
        continue;
      }
      const referencedColumns = mapFieldNamesToColumns({
        modelName: targetMapping.model.name,
        fieldNames: parsedRelation.references,
        mapping: targetMapping,
        sourceId,
        diagnostics,
        span: relationAttribute.relation.span,
        contextLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
      });
      if (!referencedColumns) {
        continue;
      }
      if (localColumns.length !== referencedColumns.length) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" must provide the same number of fields and references`,
          sourceId,
          span: relationAttribute.relation.span,
        });
        continue;
      }

      const onDelete = parsedRelation.onDelete
        ? normalizeReferentialAction({
            modelName: model.name,
            fieldName: relationAttribute.field.name,
            actionName: 'onDelete',
            actionToken: parsedRelation.onDelete,
            sourceId,
            span: relationAttribute.field.span,
            diagnostics,
          })
        : undefined;
      const onUpdate = parsedRelation.onUpdate
        ? normalizeReferentialAction({
            modelName: model.name,
            fieldName: relationAttribute.field.name,
            actionName: 'onUpdate',
            actionToken: parsedRelation.onUpdate,
            sourceId,
            span: relationAttribute.field.span,
            diagnostics,
          })
        : undefined;

      foreignKeyNodes.push({
        columns: localColumns,
        references: {
          model: targetMapping.model.name,
          table: targetMapping.tableName,
          columns: referencedColumns,
        },
        ...ifDefined('name', parsedRelation.constraintName),
        ...ifDefined('onDelete', onDelete),
        ...ifDefined('onUpdate', onUpdate),
      });

      fkRelationMetadata.push({
        declaringModelName: model.name,
        declaringFieldName: relationAttribute.field.name,
        declaringTableName: tableName,
        targetModelName: targetMapping.model.name,
        targetTableName: targetMapping.tableName,
        ...ifDefined('relationName', parsedRelation.relationName),
        localColumns,
        referencedColumns,
      });
    }

    semanticModels.push({
      modelName: model.name,
      tableName,
      fields: resolvedFields.map((resolvedField) => ({
        fieldName: resolvedField.field.name,
        columnName: resolvedField.columnName,
        descriptor: resolvedField.descriptor,
        nullable: resolvedField.field.optional,
        ...ifDefined('default', resolvedField.defaultValue),
        ...ifDefined('executionDefault', resolvedField.executionDefault),
      })),
      ...(primaryKeyColumns.length > 0
        ? {
            id: {
              columns: primaryKeyColumns,
              ...ifDefined('name', primaryKeyName),
            },
          }
        : {}),
      ...(uniqueConstraints.length > 0 ? { uniques: uniqueConstraints } : {}),
      ...(indexNodes.length > 0 ? { indexes: indexNodes } : {}),
      ...(foreignKeyNodes.length > 0 ? { foreignKeys: foreignKeyNodes } : {}),
    });
  }

  const { modelRelations, fkRelationsByPair } = indexFkRelations({ fkRelationMetadata });
  applyBackrelationCandidates({
    backrelationCandidates,
    fkRelationsByPair,
    modelRelations,
    diagnostics,
    sourceId,
  });

  if (diagnostics.length > 0) {
    const dedupedDiagnostics = diagnostics.filter(
      (diagnostic, index, allDiagnostics) =>
        allDiagnostics.findIndex(
          (candidate) =>
            candidate.code === diagnostic.code &&
            candidate.message === diagnostic.message &&
            candidate.sourceId === diagnostic.sourceId &&
            ((candidate.span && diagnostic.span && hasSameSpan(candidate.span, diagnostic.span)) ||
              (!candidate.span && !diagnostic.span)),
        ) === index,
    );

    return notOk({
      summary: 'PSL to SQL Contract IR normalization failed',
      diagnostics: dedupedDiagnostics,
    });
  }

  const contract = buildSqlContractFromSemanticDefinition({
    target: input.target,
    ...ifDefined(
      'extensionPacks',
      buildComposedExtensionPackRefs(
        input.target,
        [...composedExtensions].sort(compareStrings),
        input.composedExtensionPackRefs,
      ),
    ),
    ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
    models: semanticModels.map((model) => ({
      ...model,
      ...(modelRelations.has(model.modelName)
        ? {
            relations: [...(modelRelations.get(model.modelName) ?? [])].sort((left, right) =>
              compareStrings(left.fieldName, right.fieldName),
            ),
          }
        : {}),
    })),
  });
  return ok(contract);
}
