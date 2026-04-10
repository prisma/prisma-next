import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
} from '@prisma-next/contract/types';
import type {
  AuthoringContributions,
  AuthoringTypeConstructorDescriptor,
} from '@prisma-next/framework-components/authoring';
import { instantiateAuthoringTypeConstructor } from '@prisma-next/framework-components/authoring';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ParsePslDocumentResult,
  PslAttribute,
  PslCompositeType,
  PslEnum,
  PslField,
  PslModel,
  PslNamedTypeDeclaration,
  PslSpan,
} from '@prisma-next/psl-parser';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ForeignKeyNode,
  type IndexNode,
  type ModelNode,
  type UniqueConstraintNode,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import type {
  ControlMutationDefaultRegistry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from './default-function-registry';
import {
  getAttribute,
  getPositionalArgument,
  mapFieldNamesToColumns,
  parseAttributeFieldList,
  parseConstraintMapArgument,
  parseMapName,
  parseQuotedStringLiteral,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  getAuthoringTypeConstructor,
  instantiatePslTypeConstructor,
  resolveDbNativeTypeAttribute,
  resolveFieldTypeDescriptor,
  resolvePslTypeConstructorDescriptor,
  toNamedTypeFieldDescriptor,
} from './psl-column-resolution';
import {
  buildModelMappings,
  collectResolvedFields,
  type ModelNameMapping,
  type ResolvedField,
} from './psl-field-resolution';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
  parseRelationAttribute,
  validateNavigationListFieldAttributes,
} from './psl-relation-resolution';

export interface InterpretPslDocumentToSqlContractInput {
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

interface ProcessEnumDeclarationsInput {
  readonly enums: readonly PslEnum[];
  readonly sourceId: string;
  readonly enumTypeConstructor: AuthoringTypeConstructorDescriptor | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function processEnumDeclarations(input: ProcessEnumDeclarationsInput): {
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
} {
  const storageTypes: Record<string, StorageTypeInstance> = {};
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();

  for (const enumDeclaration of input.enums) {
    const nativeType = parseMapName({
      attribute: getAttribute(enumDeclaration.attributes, 'map'),
      defaultValue: enumDeclaration.name,
      sourceId: input.sourceId,
      diagnostics: input.diagnostics,
      entityLabel: `Enum "${enumDeclaration.name}"`,
      span: enumDeclaration.span,
    });
    const enumStorageType = input.enumTypeConstructor
      ? instantiateAuthoringTypeConstructor(input.enumTypeConstructor, [
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

  return { storageTypes, enumTypeDescriptors };
}

interface ResolveNamedTypeDeclarationsInput {
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly sourceId: string;
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function validateNamedTypeAttributes(input: {
  readonly declaration: PslNamedTypeDeclaration;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly composedExtensions: ReadonlySet<string>;
  readonly allowDbNativeType: boolean;
}): {
  readonly dbNativeTypeAttribute: PslAttribute | undefined;
  readonly hasUnsupportedNamedTypeAttribute: boolean;
} {
  const dbNativeTypeAttribute = input.allowDbNativeType
    ? input.declaration.attributes.find((attribute) => attribute.name.startsWith('db.'))
    : undefined;
  let hasUnsupportedNamedTypeAttribute = false;

  for (const attribute of input.declaration.attributes) {
    if (input.allowDbNativeType && attribute.name.startsWith('db.')) {
      continue;
    }

    const uncomposedNamespace = checkUncomposedNamespace(attribute.name, input.composedExtensions);
    if (uncomposedNamespace) {
      input.diagnostics.push({
        code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
        message: `Attribute "@${attribute.name}" uses unrecognized namespace "${uncomposedNamespace}". Add extension pack "${uncomposedNamespace}" to extensionPacks in prisma-next.config.ts.`,
        sourceId: input.sourceId,
        span: attribute.span,
      });
      hasUnsupportedNamedTypeAttribute = true;
      continue;
    }

    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
      message: `Named type "${input.declaration.name}" uses unsupported attribute "${attribute.name}"`,
      sourceId: input.sourceId,
      span: attribute.span,
    });
    hasUnsupportedNamedTypeAttribute = true;
  }

  return { dbNativeTypeAttribute, hasUnsupportedNamedTypeAttribute };
}

function resolveNamedTypeDeclarations(input: ResolveNamedTypeDeclarationsInput): {
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
} {
  const storageTypes: Record<string, StorageTypeInstance> = {};
  const namedTypeDescriptors = new Map<string, ColumnDescriptor>();

  for (const declaration of input.declarations) {
    if (declaration.typeConstructor) {
      const { hasUnsupportedNamedTypeAttribute } = validateNamedTypeAttributes({
        declaration,
        sourceId: input.sourceId,
        diagnostics: input.diagnostics,
        composedExtensions: input.composedExtensions,
        allowDbNativeType: false,
      });
      if (hasUnsupportedNamedTypeAttribute) {
        continue;
      }

      const helperPath = declaration.typeConstructor.path.join('.');
      const typeConstructor = resolvePslTypeConstructorDescriptor({
        call: declaration.typeConstructor,
        authoringContributions: input.authoringContributions,
        composedExtensions: input.composedExtensions,
        familyId: input.familyId,
        targetId: input.targetId,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        unsupportedCode: 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR',
        unsupportedMessage: `Named type "${declaration.name}" references unsupported constructor "${helperPath}"`,
      });
      if (!typeConstructor) {
        continue;
      }

      const storageType = instantiatePslTypeConstructor({
        call: declaration.typeConstructor,
        descriptor: typeConstructor,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: `Named type "${declaration.name}"`,
      });
      if (!storageType) {
        continue;
      }

      namedTypeDescriptors.set(
        declaration.name,
        toNamedTypeFieldDescriptor(declaration.name, storageType),
      );
      storageTypes[declaration.name] = {
        codecId: storageType.codecId,
        nativeType: storageType.nativeType,
        typeParams: storageType.typeParams ?? {},
      };
      continue;
    }

    if (!declaration.baseType) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" must declare a base type or constructor`,
        sourceId: input.sourceId,
        span: declaration.span,
      });
      continue;
    }

    const baseDescriptor =
      input.enumTypeDescriptors.get(declaration.baseType) ??
      input.scalarTypeDescriptors.get(declaration.baseType);
    if (!baseDescriptor) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" references unsupported base type "${declaration.baseType}"`,
        sourceId: input.sourceId,
        span: declaration.span,
      });
      continue;
    }

    const { dbNativeTypeAttribute, hasUnsupportedNamedTypeAttribute } = validateNamedTypeAttributes(
      {
        declaration,
        sourceId: input.sourceId,
        diagnostics: input.diagnostics,
        composedExtensions: input.composedExtensions,
        allowDbNativeType: true,
      },
    );
    if (hasUnsupportedNamedTypeAttribute) {
      continue;
    }

    if (dbNativeTypeAttribute) {
      const descriptor = resolveDbNativeTypeAttribute({
        attribute: dbNativeTypeAttribute,
        baseType: declaration.baseType,
        baseDescriptor,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
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

  return { storageTypes, namedTypeDescriptors };
}

interface BuildModelNodeInput {
  readonly model: PslModel;
  readonly mapping: ModelNameMapping;
  readonly modelMappings: ReadonlyMap<string, ModelNameMapping>;
  readonly modelNames: Set<string>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly composedExtensions: Set<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}

interface BuildModelNodeResult {
  readonly modelNode: ModelNode;
  readonly fkRelationMetadata: FkRelationMetadata[];
  readonly backrelationCandidates: ModelBackrelationCandidate[];
  readonly resolvedFields: readonly ResolvedField[];
}

function buildModelNodeFromPsl(input: BuildModelNodeInput): BuildModelNodeResult {
  const { model, mapping, sourceId, diagnostics } = input;
  const tableName = mapping.tableName;

  const resolvedFields = collectResolvedFields({
    model,
    mapping,
    enumTypeDescriptors: input.enumTypeDescriptors,
    namedTypeDescriptors: input.namedTypeDescriptors,
    modelNames: input.modelNames,
    compositeTypeNames: input.compositeTypeNames,
    composedExtensions: input.composedExtensions,
    authoringContributions: input.authoringContributions,
    familyId: input.familyId,
    targetId: input.targetId,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorDescriptorById: input.generatorDescriptorById,
    diagnostics,
    sourceId,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
  });

  const primaryKeyFields = resolvedFields.filter((field) => field.isId);
  const primaryKeyColumns = primaryKeyFields.map((field) => field.columnName);
  const primaryKeyName = primaryKeyFields.length === 1 ? primaryKeyFields[0]?.idName : undefined;
  const isVariantModel = model.attributes.some((attr) => attr.name === 'base');
  if (primaryKeyColumns.length === 0 && !isVariantModel) {
    diagnostics.push({
      code: 'PSL_MISSING_PRIMARY_KEY',
      message: `Model "${model.name}" must declare at least one @id field for SQL provider`,
      sourceId,
      span: model.span,
    });
  }

  const resultBackrelationCandidates: ModelBackrelationCandidate[] = [];
  for (const field of model.fields) {
    if (!field.list || !input.modelNames.has(field.typeName)) {
      continue;
    }
    const attributesValid = validateNavigationListFieldAttributes({
      modelName: model.name,
      field,
      sourceId,
      composedExtensions: input.composedExtensions,
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

    resultBackrelationCandidates.push({
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
  const uniqueConstraints: UniqueConstraintNode[] = resolvedFields
    .filter((field) => field.isUnique)
    .map((field) => ({
      columns: [field.columnName],
      ...ifDefined('name', field.uniqueName),
    }));
  const indexNodes: IndexNode[] = [];
  const foreignKeyNodes: ForeignKeyNode[] = [];

  for (const modelAttribute of model.attributes) {
    if (modelAttribute.name === 'map') {
      continue;
    }
    if (modelAttribute.name === 'discriminator' || modelAttribute.name === 'base') {
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
    const uncomposedNamespace = checkUncomposedNamespace(
      modelAttribute.name,
      input.composedExtensions,
    );
    if (uncomposedNamespace) {
      diagnostics.push({
        code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
        message: `Attribute "@@${modelAttribute.name}" uses unrecognized namespace "${uncomposedNamespace}". Add extension pack "${uncomposedNamespace}" to extensionPacks in prisma-next.config.ts.`,
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

  const resultFkRelationMetadata: FkRelationMetadata[] = [];
  for (const relationAttribute of relationAttributes) {
    if (relationAttribute.field.list) {
      continue;
    }

    if (!input.modelNames.has(relationAttribute.field.typeName)) {
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

    const targetMapping = input.modelMappings.get(relationAttribute.field.typeName);
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

    resultFkRelationMetadata.push({
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

  return {
    modelNode: {
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
    },
    fkRelationMetadata: resultFkRelationMetadata,
    backrelationCandidates: resultBackrelationCandidates,
    resolvedFields,
  };
}

interface BuildValueObjectsInput {
  readonly compositeTypes: readonly PslCompositeType[];
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}

function buildValueObjects(input: BuildValueObjectsInput): Record<string, ContractValueObject> {
  const {
    compositeTypes,
    enumTypeDescriptors,
    namedTypeDescriptors,
    scalarTypeDescriptors,
    composedExtensions,
    familyId,
    targetId,
    authoringContributions,
    diagnostics,
    sourceId,
  } = input;
  const valueObjects: Record<string, ContractValueObject> = {};
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));

  for (const compositeType of compositeTypes) {
    const fields: Record<string, ContractField> = {};
    for (const field of compositeType.fields) {
      if (compositeTypeNames.has(field.typeName)) {
        const result: ContractField = {
          type: { kind: 'valueObject', name: field.typeName },
          nullable: field.optional,
        };
        fields[field.name] = field.list ? { ...result, many: true } : result;
        continue;
      }
      const descriptor = resolveFieldTypeDescriptor({
        field,
        enumTypeDescriptors: enumTypeDescriptors as Map<string, ColumnDescriptor>,
        namedTypeDescriptors: namedTypeDescriptors as Map<string, ColumnDescriptor>,
        scalarTypeDescriptors,
        authoringContributions,
        composedExtensions,
        familyId,
        targetId,
        diagnostics,
        sourceId,
        entityLabel: `Field "${compositeType.name}.${field.name}"`,
      });
      if (!descriptor) {
        if (!field.typeConstructor) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${compositeType.name}.${field.name}" type "${field.typeName}" is not supported`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      fields[field.name] = {
        nullable: field.optional,
        type: { kind: 'scalar', codecId: descriptor.codecId },
      };
    }
    valueObjects[compositeType.name] = { fields };
  }

  return valueObjects;
}

function patchModelDomainFields(
  models: Record<string, ContractModel>,
  modelResolvedFields: ReadonlyMap<string, readonly ResolvedField[]>,
): Record<string, ContractModel> {
  let patched = models;

  for (const [modelName, resolvedFields] of modelResolvedFields) {
    const model = patched[modelName];
    if (!model) continue;

    let needsPatch = false;
    const patchedFields: Record<string, ContractField> = { ...model.fields };

    for (const rf of resolvedFields) {
      if (rf.valueObjectTypeName) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'valueObject', name: rf.valueObjectTypeName },
          ...(rf.many ? { many: true as const } : {}),
        };
      } else if (rf.many && rf.scalarCodecId) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'scalar', codecId: rf.scalarCodecId },
          many: true as const,
        };
      }
    }

    if (needsPatch) {
      patched = { ...patched, [modelName]: { ...model, fields: patchedFields } };
    }
  }

  return patched;
}

type DiscriminatorDeclaration = {
  readonly fieldName: string;
  readonly span: ContractSourceDiagnosticSpan;
};

type BaseDeclaration = {
  readonly baseName: string;
  readonly value: string;
  readonly span: ContractSourceDiagnosticSpan;
};

function collectPolymorphismDeclarations(
  models: readonly PslModel[],
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): {
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
} {
  const discriminatorDeclarations = new Map<string, DiscriminatorDeclaration>();
  const baseDeclarations = new Map<string, BaseDeclaration>();

  for (const model of models) {
    for (const attr of model.attributes) {
      if (attr.name === 'discriminator') {
        const fieldName = getPositionalArgument(attr);
        if (!fieldName) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@discriminator requires a field name argument`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const discField = model.fields.find((f) => f.name === fieldName);
        if (discField && discField.typeName !== 'String') {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Discriminator field "${fieldName}" on model "${model.name}" must be of type String, but is "${discField.typeName}"`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        discriminatorDeclarations.set(model.name, { fieldName, span: attr.span });
      }

      if (attr.name === 'base') {
        const baseName = getPositionalArgument(attr, 0);
        const rawValue = getPositionalArgument(attr, 1);
        if (!baseName || !rawValue) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@base requires two arguments: base model name and discriminator value`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const value = parseQuotedStringLiteral(rawValue);
        if (value === undefined) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@base discriminator value must be a quoted string literal`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        baseDeclarations.set(model.name, { baseName, value, span: attr.span });
      }
    }
  }

  return { discriminatorDeclarations, baseDeclarations };
}

function resolvePolymorphism(
  models: Record<string, ContractModel>,
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>,
  baseDeclarations: Map<string, BaseDeclaration>,
  modelNames: Set<string>,
  modelMappings: ReadonlyMap<string, ModelNameMapping>,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): Record<string, ContractModel> {
  let patched = models;

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
    const seenValues = new Map<string, string>();

    for (const [variantName, baseDecl] of baseDeclarations) {
      if (baseDecl.baseName !== modelName) continue;

      const existingVariant = seenValues.get(baseDecl.value);
      if (existingVariant) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          message: `Discriminator value "${baseDecl.value}" is used by both "${existingVariant}" and "${variantName}" on base model "${modelName}"`,
          sourceId,
          span: baseDecl.span,
        });
        continue;
      }
      seenValues.set(baseDecl.value, variantName);
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

    const variantModel = patched[variantName];
    if (!variantModel) continue;

    const baseMapping = modelMappings.get(baseDecl.baseName);
    const variantMapping = modelMappings.get(variantName);
    const hasExplicitMap =
      variantMapping?.model.attributes.some((attr) => attr.name === 'map') ?? false;
    const resolvedTable = hasExplicitMap ? variantMapping?.tableName : baseMapping?.tableName;

    patched = {
      ...patched,
      [variantName]: {
        ...variantModel,
        base: baseDecl.baseName,
        ...(resolvedTable ? { storage: { ...variantModel.storage, table: resolvedTable } } : {}),
      },
    };
  }

  return patched;
}

export function interpretPslDocumentToSqlContract(
  input: InterpretPslDocumentToSqlContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const sourceId = input.document.ast.sourceId;
  if (!input.target) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
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
      summary: 'PSL to SQL contract interpretation failed',
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
  const models = input.document.ast.models ?? [];
  const enums = input.document.ast.enums ?? [];
  const compositeTypes = input.document.ast.compositeTypes ?? [];
  const modelNames = new Set(models.map((model) => model.name));
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));
  const composedExtensions = new Set(input.composedExtensionPacks ?? []);
  const defaultFunctionRegistry =
    input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map<string, never>();
  const generatorDescriptors = input.controlMutationDefaults?.generatorDescriptors ?? [];
  const generatorDescriptorById = new Map<string, MutationDefaultGeneratorDescriptor>();
  for (const descriptor of generatorDescriptors) {
    generatorDescriptorById.set(descriptor.id, descriptor);
  }

  const enumResult = processEnumDeclarations({
    enums,
    sourceId,
    enumTypeConstructor: getAuthoringTypeConstructor(input.authoringContributions, ['enum']),
    diagnostics,
  });

  const namedTypeResult = resolveNamedTypeDeclarations({
    declarations: input.document.ast.types?.declarations ?? [],
    sourceId,
    enumTypeDescriptors: enumResult.enumTypeDescriptors,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
  });

  const storageTypes = { ...enumResult.storageTypes, ...namedTypeResult.storageTypes };

  const modelMappings = buildModelMappings(models, diagnostics, sourceId);
  const modelNodes: ModelNode[] = [];
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const backrelationCandidates: ModelBackrelationCandidate[] = [];
  const modelResolvedFields = new Map<string, readonly ResolvedField[]>();

  for (const model of models) {
    const mapping = modelMappings.get(model.name);
    if (!mapping) {
      continue;
    }
    const result = buildModelNodeFromPsl({
      model,
      mapping,
      modelMappings,
      modelNames,
      compositeTypeNames,
      enumTypeDescriptors: enumResult.enumTypeDescriptors,
      namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
      composedExtensions,
      familyId: input.target.familyId,
      targetId: input.target.targetId,
      authoringContributions: input.authoringContributions,
      defaultFunctionRegistry,
      generatorDescriptorById,
      scalarTypeDescriptors: input.scalarTypeDescriptors,
      sourceId,
      diagnostics,
    });
    modelNodes.push(result.modelNode);
    fkRelationMetadata.push(...result.fkRelationMetadata);
    backrelationCandidates.push(...result.backrelationCandidates);
    modelResolvedFields.set(model.name, result.resolvedFields);
  }

  const { modelRelations, fkRelationsByPair } = indexFkRelations({ fkRelationMetadata });
  applyBackrelationCandidates({
    backrelationCandidates,
    fkRelationsByPair,
    modelRelations,
    diagnostics,
    sourceId,
  });

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    models,
    sourceId,
    diagnostics,
  );

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
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: dedupedDiagnostics,
    });
  }

  const contract = buildSqlContractFromDefinition({
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
    models: modelNodes.map((model) => ({
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

  const valueObjects = buildValueObjects({
    compositeTypes,
    enumTypeDescriptors: enumResult.enumTypeDescriptors,
    namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
    sourceId,
  });

  if (diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics,
    });
  }

  let patchedModels = patchModelDomainFields(
    contract.models as Record<string, ContractModel>,
    modelResolvedFields,
  );

  const polyDiagnostics: ContractSourceDiagnostic[] = [];
  patchedModels = resolvePolymorphism(
    patchedModels,
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    modelMappings,
    sourceId,
    polyDiagnostics,
  );

  if (polyDiagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: polyDiagnostics,
    });
  }

  const variantModelNames = new Set(baseDeclarations.keys());
  const filteredRoots = Object.fromEntries(
    Object.entries(contract.roots).filter(([, modelName]) => !variantModelNames.has(modelName)),
  );

  const patchedContract: Contract = {
    ...contract,
    roots: filteredRoots,
    models: patchedModels,
    ...(Object.keys(valueObjects).length > 0 ? { valueObjects } : {}),
  };

  return ok(patchedContract);
}
