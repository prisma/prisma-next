import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { PslAttribute, PslField, PslModel } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from './default-function-registry';
import {
  getAttribute,
  lowerFirst,
  parseConstraintMapArgument,
  parseMapName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  lowerDefaultForField,
  reportUncomposedNamespace,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';

export type ResolvedField = {
  readonly field: PslField;
  readonly columnName: string;
  readonly descriptor: ColumnDescriptor;
  readonly defaultValue?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
  readonly isId: boolean;
  readonly isUnique: boolean;
  readonly idName?: string;
  readonly uniqueName?: string;
  readonly many?: true;
  readonly valueObjectTypeName?: string;
  readonly scalarCodecId?: string;
};

export type ModelNameMapping = {
  readonly model: PslModel;
  readonly tableName: string;
  readonly fieldColumns: Map<string, string>;
};

export interface CollectResolvedFieldsInput {
  readonly model: PslModel;
  readonly mapping: ModelNameMapping;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly modelNames: Set<string>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly composedExtensions: Set<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly familyId: string;
  readonly targetId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
}

const BUILTIN_FIELD_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'id',
  'unique',
  'default',
  'relation',
  'map',
]);

function validateFieldAttributes(input: {
  readonly model: PslModel;
  readonly field: PslField;
  readonly composedExtensions: ReadonlySet<string>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): void {
  for (const attribute of input.field.attributes) {
    if (BUILTIN_FIELD_ATTRIBUTE_NAMES.has(attribute.name)) {
      continue;
    }

    const uncomposedNamespace = checkUncomposedNamespace(attribute.name, input.composedExtensions);
    if (uncomposedNamespace) {
      reportUncomposedNamespace({
        subjectLabel: `Attribute "@${attribute.name}"`,
        namespace: uncomposedNamespace,
        sourceId: input.sourceId,
        span: attribute.span,
        diagnostics: input.diagnostics,
      });
      continue;
    }

    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Field "${input.model.name}.${input.field.name}" uses unsupported attribute "@${attribute.name}"`,
      sourceId: input.sourceId,
      span: attribute.span,
    });
  }
}

function extractFieldConstraintNames(input: {
  readonly model: PslModel;
  readonly field: PslField;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly idAttribute: PslAttribute | undefined;
  readonly uniqueAttribute: PslAttribute | undefined;
  readonly idName: string | undefined;
  readonly uniqueName: string | undefined;
} {
  const idAttribute = getAttribute(input.field.attributes, 'id');
  const uniqueAttribute = getAttribute(input.field.attributes, 'unique');
  const idName = parseConstraintMapArgument({
    attribute: idAttribute,
    sourceId: input.sourceId,
    diagnostics: input.diagnostics,
    entityLabel: `Field "${input.model.name}.${input.field.name}" @id`,
    span: input.field.span,
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
  });
  const uniqueName = parseConstraintMapArgument({
    attribute: uniqueAttribute,
    sourceId: input.sourceId,
    diagnostics: input.diagnostics,
    entityLabel: `Field "${input.model.name}.${input.field.name}" @unique`,
    span: input.field.span,
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
  });
  return { idAttribute, uniqueAttribute, idName, uniqueName };
}

export function collectResolvedFields(input: CollectResolvedFieldsInput): ResolvedField[] {
  const {
    model,
    mapping,
    enumTypeDescriptors,
    namedTypeDescriptors,
    modelNames,
    compositeTypeNames,
    composedExtensions,
    authoringContributions,
    familyId,
    targetId,
    defaultFunctionRegistry,
    generatorDescriptorById,
    diagnostics,
    sourceId,
    scalarTypeDescriptors,
  } = input;
  const resolvedFields: ResolvedField[] = [];

  for (const field of model.fields) {
    if (field.list && modelNames.has(field.typeName)) {
      continue;
    }

    validateFieldAttributes({ model, field, composedExtensions, diagnostics, sourceId });

    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (relationAttribute && modelNames.has(field.typeName)) {
      continue;
    }

    const isValueObjectField = compositeTypeNames.has(field.typeName);
    const isListField = field.list;

    let descriptor: ColumnDescriptor | undefined;
    let scalarCodecId: string | undefined;
    const resolveInput = {
      field,
      enumTypeDescriptors,
      namedTypeDescriptors,
      scalarTypeDescriptors,
      authoringContributions,
      composedExtensions,
      familyId,
      targetId,
      diagnostics,
      sourceId,
      entityLabel: `Field "${model.name}.${field.name}"`,
    };

    if (isValueObjectField) {
      descriptor = scalarTypeDescriptors.get('Json');
    } else if (isListField) {
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      scalarCodecId = resolved.descriptor.codecId;
      descriptor = scalarTypeDescriptors.get('Json');
    } else {
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      descriptor = resolved.descriptor;
    }

    if (!descriptor) {
      continue;
    }

    const defaultAttribute = getAttribute(field.attributes, 'default');
    const loweredDefault = defaultAttribute
      ? lowerDefaultForField({
          modelName: model.name,
          fieldName: field.name,
          defaultAttribute,
          columnDescriptor: descriptor,
          generatorDescriptorById,
          sourceId,
          defaultFunctionRegistry,
          diagnostics,
        })
      : {};
    if (field.optional && loweredDefault.executionDefault) {
      const generatorDescription =
        loweredDefault.executionDefault.kind === 'generator'
          ? `"${loweredDefault.executionDefault.id}"`
          : 'for this field';
      diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
        message: `Field "${model.name}.${field.name}" cannot be optional when using execution default ${generatorDescription}. Remove "?" or use a storage default.`,
        sourceId,
        span: defaultAttribute?.span ?? field.span,
      });
      continue;
    }
    if (loweredDefault.executionDefault) {
      const generatorDescriptor = generatorDescriptorById.get(loweredDefault.executionDefault.id);
      const generatedDescriptor = generatorDescriptor?.resolveGeneratedColumnDescriptor?.({
        generated: loweredDefault.executionDefault,
      });
      if (generatedDescriptor) {
        descriptor = generatedDescriptor;
      }
    }
    const mappedColumnName = mapping.fieldColumns.get(field.name) ?? field.name;
    const { idAttribute, uniqueAttribute, idName, uniqueName } = extractFieldConstraintNames({
      model,
      field,
      sourceId,
      diagnostics,
    });

    resolvedFields.push({
      field,
      columnName: mappedColumnName,
      descriptor,
      ...ifDefined('defaultValue', loweredDefault.defaultValue),
      ...ifDefined('executionDefault', loweredDefault.executionDefault),
      isId: Boolean(idAttribute),
      isUnique: Boolean(uniqueAttribute),
      ...ifDefined('idName', idName),
      ...ifDefined('uniqueName', uniqueName),
      ...ifDefined('many', isListField ? (true as const) : undefined),
      ...ifDefined('valueObjectTypeName', isValueObjectField ? field.typeName : undefined),
      ...ifDefined('scalarCodecId', scalarCodecId),
    });
  }

  return resolvedFields;
}

export function buildModelMappings(
  models: readonly PslModel[],
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
): Map<string, ModelNameMapping> {
  const result = new Map<string, ModelNameMapping>();
  for (const model of models) {
    const mapAttribute = getAttribute(model.attributes, 'map');
    const tableName = parseMapName({
      attribute: mapAttribute,
      defaultValue: lowerFirst(model.name),
      sourceId,
      diagnostics,
      entityLabel: `Model "${model.name}"`,
      span: model.span,
    });
    const fieldColumns = new Map<string, string>();
    for (const field of model.fields) {
      const fieldMapAttribute = getAttribute(field.attributes, 'map');
      const columnName = parseMapName({
        attribute: fieldMapAttribute,
        defaultValue: field.name,
        sourceId,
        diagnostics,
        entityLabel: `Field "${model.name}.${field.name}"`,
        span: field.span,
      });
      fieldColumns.set(field.name, columnName);
    }
    result.set(model.name, {
      model,
      tableName,
      fieldColumns,
    });
  }
  return result;
}
