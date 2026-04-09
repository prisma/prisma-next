import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { PslField, PslModel } from '@prisma-next/psl-parser';
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

export function collectResolvedFields(
  model: PslModel,
  mapping: ModelNameMapping,
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
  modelNames: Set<string>,
  compositeTypeNames: ReadonlySet<string>,
  composedExtensions: Set<string>,
  authoringContributions: AuthoringContributions | undefined,
  familyId: string,
  targetId: string,
  defaultFunctionRegistry: ControlMutationDefaultRegistry,
  generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
  scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
): ResolvedField[] {
  const resolvedFields: ResolvedField[] = [];

  for (const field of model.fields) {
    if (field.list && modelNames.has(field.typeName)) {
      continue;
    }

    for (const attribute of field.attributes) {
      if (
        attribute.name === 'id' ||
        attribute.name === 'unique' ||
        attribute.name === 'default' ||
        attribute.name === 'relation' ||
        attribute.name === 'map'
      ) {
        continue;
      }

      const uncomposedNamespace = checkUncomposedNamespace(attribute.name, composedExtensions);
      if (uncomposedNamespace) {
        diagnostics.push({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: `Attribute "@${attribute.name}" uses unrecognized namespace "${uncomposedNamespace}". Add extension pack "${uncomposedNamespace}" to extensionPacks in prisma-next.config.ts.`,
          sourceId,
          span: attribute.span,
        });
        continue;
      }

      diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: `Field "${model.name}.${field.name}" uses unsupported attribute "@${attribute.name}"`,
        sourceId,
        span: attribute.span,
      });
    }

    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (relationAttribute && modelNames.has(field.typeName)) {
      continue;
    }

    const isValueObjectField = compositeTypeNames.has(field.typeName);
    const isListField = field.list;

    let descriptor: ColumnDescriptor | undefined;
    let scalarCodecId: string | undefined;

    if (isValueObjectField) {
      descriptor = scalarTypeDescriptors.get('Json');
    } else if (isListField) {
      const originalDescriptor = resolveFieldTypeDescriptor({
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
      });
      if (!originalDescriptor) {
        if (!field.typeConstructor) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      scalarCodecId = originalDescriptor.codecId;
      descriptor = scalarTypeDescriptors.get('Json');
    } else {
      descriptor = resolveFieldTypeDescriptor({
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
      });
    }

    if (!descriptor) {
      if (!field.typeConstructor) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
          sourceId,
          span: field.span,
        });
      }
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
    const idAttribute = getAttribute(field.attributes, 'id');
    const uniqueAttribute = getAttribute(field.attributes, 'unique');
    const idName = parseConstraintMapArgument({
      attribute: idAttribute,
      sourceId,
      diagnostics,
      entityLabel: `Field "${model.name}.${field.name}" @id`,
      span: field.span,
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    });
    const uniqueName = parseConstraintMapArgument({
      attribute: uniqueAttribute,
      sourceId,
      diagnostics,
      entityLabel: `Field "${model.name}.${field.name}" @unique`,
      span: field.span,
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
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
