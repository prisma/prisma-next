import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultPhases,
} from '@prisma-next/contract/types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { CapabilityMatrix } from '@prisma-next/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from '@prisma-next/framework-components/control';
import type { FieldSymbol, ModelSymbol, ResolvedAttribute } from '@prisma-next/psl-parser';
import type { EnumTypeHandle } from '@prisma-next/sql-contract-ts/contract-builder';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  getAttribute,
  lowerFirst,
  parseConstraintMapArgument,
  parseMapName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor, FieldPresetContributions } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  lowerDefaultForField,
  reportUncomposedNamespace,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';

type LoweredFieldDefault = {
  readonly defaultValue?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
};

function lowerEnumDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly defaultAttribute: ResolvedAttribute;
  readonly enumHandle: EnumTypeHandle;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): LoweredFieldDefault {
  const positionalEntries = input.defaultAttribute.args.filter((arg) => arg.kind === 'positional');
  const hasNamedEntries = input.defaultAttribute.args.some((arg) => arg.kind === 'named');
  const expressionEntry = positionalEntries[0];
  if (hasNamedEntries || positionalEntries.length !== 1 || expressionEntry === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: `Field "${input.modelName}.${input.fieldName}" @default on an enum field expects exactly one positional enum member argument.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const raw = expressionEntry.value.trim();
  const isQuotedString = /^(['"]).*\1$/.test(raw);
  const isFunctionCall = raw.includes('(') && raw.endsWith(')');

  if (isQuotedString || isFunctionCall) {
    input.diagnostics.push({
      code: 'PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME',
      message: `Field "${input.modelName}.${input.fieldName}" @default on an enum field must name a member (e.g. @default(Low)), not a raw value or function.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const match = input.enumHandle.enumMembers.find((m) => m.name === raw);
  if (!match) {
    const validNames = input.enumHandle.enumMembers.map((m) => m.name).join(', ');
    input.diagnostics.push({
      code: 'PSL_ENUM_UNKNOWN_DEFAULT_MEMBER',
      message: `Field "${input.modelName}.${input.fieldName}" @default(${raw}) does not name a member of ${input.enumHandle.enumName}. Valid members: ${validNames}.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  return {
    defaultValue: {
      kind: 'literal',
      value: blindCast<
        ColumnDefaultLiteralInputValue,
        'enum member values are codec-validated JsonValue-compatible scalars'
      >(match.value),
    },
  };
}

export type ResolvedField = {
  readonly field: FieldSymbol;
  readonly columnName: string;
  readonly descriptor: ColumnDescriptor;
  readonly nullable: boolean;
  readonly defaultValue?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly isId: boolean;
  readonly isUnique: boolean;
  readonly idName?: string;
  readonly uniqueName?: string;
  readonly many?: true;
  readonly valueObjectTypeName?: string;
  readonly scalarCodecId?: string;
};

export type ModelNameMapping = {
  readonly model: ModelSymbol;
  readonly tableName: string;
  readonly fieldColumns: Map<string, string>;
};

/**
 * A PSL model paired with its resolved namespace coordinate (undefined when
 * the target leaves the model late-bound). Two models may share a bare name
 * across namespaces, so structures that must distinguish them are keyed by
 * the `(namespaceId, modelName)` coordinate produced by
 * {@link modelCoordinateKey} rather than the bare model name.
 */
export type ModelNamespaceEntry = {
  readonly model: ModelSymbol;
  readonly namespaceId: string | undefined;
};

const MODEL_COORDINATE_SEPARATOR = '\u0000';

export function modelCoordinateKey(namespaceId: string, modelName: string): string {
  return `${namespaceId}${MODEL_COORDINATE_SEPARATOR}${modelName}`;
}

export interface CollectResolvedFieldsInput {
  readonly model: ModelSymbol;
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
  readonly enumHandles?: ReadonlyMap<string, EnumTypeHandle>;
  readonly capabilities: CapabilityMatrix;
  /** The model's resolved namespace id — forwarded to `resolveFieldTypeDescriptor` for entity-ref value-set scoping. */
  readonly namespaceId?: string;
  /** The target's default namespace id (e.g. Postgres's `'public'`) — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-name schema-qualification. */
  readonly defaultNamespaceId?: string;
  /** Extension entities already lowered for this namespace — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly namespaceExtensionEntities?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Codec-id-keyed descriptor lookup — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly codecLookup?: CodecLookup;
}

const BUILTIN_FIELD_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'id',
  'unique',
  'default',
  'relation',
  'map',
]);

/**
 * Per-attribute migration rule for attributes that have been removed
 * from PSL in favor of the field-preset surface. The `hint` text is
 * appended to the `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` message so users
 * porting Prisma 6 schemas see "use this preset instead" inline; the
 * `suppressWhen` predicate skips the hint when the user has already
 * migrated (so they don't get told to do what they just did).
 *
 * Pairing the suppression predicate with the hint makes each entry
 * self-contained: a future entry for, say, `@id` ↔ `id.uuidv7String()` cannot
 * silently inherit the wrong predicate when added.
 */
interface RemovedAttributeRule {
  readonly hint: string;
  readonly suppressWhen: (field: FieldSymbol) => boolean;
}

const REMOVED_ATTRIBUTE_RULES: ReadonlyMap<string, RemovedAttributeRule> = new Map([
  [
    'updatedAt',
    {
      hint: 'Use `temporal.updatedAt()` as a field-preset call instead.',
      suppressWhen: (field) => field.typeConstructor?.path[0] === 'temporal',
    },
  ],
]);

// `validateFieldAttributes` short-circuits on `BUILTIN_FIELD_ATTRIBUTE_NAMES`
// before consulting `REMOVED_ATTRIBUTE_RULES`. A name appearing in both sets
// would silently suppress its migration hint, defeating the purpose of the
// hint table. Fail at module load with a clear message — the table is
// designed to grow and this is the cheap insurance against future drift.
{
  const overlap = [...REMOVED_ATTRIBUTE_RULES.keys()].filter((name) =>
    BUILTIN_FIELD_ATTRIBUTE_NAMES.has(name),
  );
  if (overlap.length > 0) {
    throw new Error(
      `BUILTIN_FIELD_ATTRIBUTE_NAMES and REMOVED_ATTRIBUTE_RULES must not overlap. Names in both: ${overlap.join(', ')}`,
    );
  }
}

function validateFieldAttributes(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly composedExtensions: ReadonlySet<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly familyId: string;
  readonly targetId: string;
}): void {
  for (const attribute of input.field.attributes) {
    if (BUILTIN_FIELD_ATTRIBUTE_NAMES.has(attribute.name)) {
      continue;
    }

    const uncomposedNamespace = checkUncomposedNamespace(attribute.name, input.composedExtensions, {
      familyId: input.familyId,
      targetId: input.targetId,
      authoringContributions: input.authoringContributions,
    });
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

    const baseMessage = `Field "${input.model.name}.${input.field.name}" uses unsupported attribute "@${attribute.name}"`;
    const removedRule = REMOVED_ATTRIBUTE_RULES.get(attribute.name);
    const message =
      removedRule && !removedRule.suppressWhen(input.field)
        ? `${baseMessage}. ${removedRule.hint}`
        : baseMessage;

    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message,
      sourceId: input.sourceId,
      span: attribute.span,
    });
  }
}

function extractFieldConstraintNames(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly idAttribute: ResolvedAttribute | undefined;
  readonly uniqueAttribute: ResolvedAttribute | undefined;
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
    enumHandles,
    capabilities,
    namespaceId,
    defaultNamespaceId,
    namespaceExtensionEntities,
    codecLookup,
  } = input;
  const resolvedFields: ResolvedField[] = [];

  for (const field of Object.values(model.fields)) {
    const isModelField = modelNames.has(field.typeName);

    if (field.list && isModelField) {
      continue;
    }

    validateFieldAttributes({
      model,
      field,
      composedExtensions,
      authoringContributions,
      diagnostics,
      sourceId,
      familyId,
      targetId,
    });

    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (isModelField && relationAttribute) {
      continue;
    }
    // Cross-contract-space relation fields (e.g. `supabase:auth.User @relation(...)`) are not
    // local model fields, but they carry a @relation attribute and should be skipped here.
    // Their FK and RelationNode lowering is handled separately in the interpreter.
    if (field.typeContractSpaceId !== undefined && relationAttribute) {
      continue;
    }

    const isValueObjectField = compositeTypeNames.has(field.typeName);
    const isListField = field.list;

    let descriptor: ColumnDescriptor | undefined;
    let scalarCodecId: string | undefined;
    let presetContributions: FieldPresetContributions | undefined;
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
      ...ifDefined('namespaceId', namespaceId),
      ...ifDefined('defaultNamespaceId', defaultNamespaceId),
      ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
      ...ifDefined('codecLookup', codecLookup),
    };

    if (isValueObjectField) {
      descriptor = scalarTypeDescriptors.get('Json');
    } else if (isListField) {
      if (capabilities['sql']?.['scalarList'] !== true) {
        diagnostics.push({
          code: 'PSL_SCALAR_LIST_UNSUPPORTED_TARGET',
          message: `Field "${model.name}.${field.name}" is a scalar list, but target "${targetId}" does not support scalar lists (the adapter does not report the "scalarList" capability). Remove the list or author it against a target that supports scalar lists.`,
          sourceId,
          span: field.span,
        });
        continue;
      }
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
      // Field presets are complete declarations — they carry their own codec
      // and do not compose with `[]` list-of semantics. Reject early.
      if (resolved.presetContributions) {
        diagnostics.push({
          code: 'PSL_PRESET_NOT_LIST',
          message: `Field "${model.name}.${field.name}" uses a field-preset call as a list element type. Presets cannot be list elements; remove "[]" or use a scalar type.`,
          sourceId,
          span: field.span,
        });
        continue;
      }
      scalarCodecId = resolved.descriptor.codecId;
      descriptor = resolved.descriptor;
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
      presetContributions = resolved.presetContributions;
    }

    if (!descriptor) {
      continue;
    }

    // Field presets are complete declarations: the preset names its own codec
    // and contributes any combination of default / executionDefaults / id /
    // unique. Optional and `@default(...)` modifiers contradict that, so they
    // are hard errors per spec FR7.
    if (presetContributions && field.optional) {
      diagnostics.push({
        code: 'PSL_PRESET_NOT_OPTIONAL',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot be optional. Remove "?" or use a different field type.`,
        sourceId,
        span: field.span,
      });
      continue;
    }

    const defaultAttribute = getAttribute(field.attributes, 'default');
    if (presetContributions && defaultAttribute) {
      diagnostics.push({
        code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot also declare @default(...). The preset already specifies the default value.`,
        sourceId,
        span: defaultAttribute.span,
      });
      continue;
    }
    const enumHandle = enumHandles?.get(field.typeName);
    const loweredDefault: LoweredFieldDefault = defaultAttribute
      ? enumHandle
        ? lowerEnumDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            defaultAttribute,
            enumHandle,
            sourceId,
            diagnostics,
          })
        : lowerDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            defaultAttribute,
            columnDescriptor: descriptor,
            generatorDescriptorById,
            sourceId,
            defaultFunctionRegistry,
            diagnostics,
            isList: isListField,
          })
      : {};
    const loweredOnCreate = loweredDefault.executionDefaults?.onCreate;
    const loweredFunctionDefault = loweredDefault.defaultValue?.kind === 'function';
    if (isListField && (loweredOnCreate || loweredFunctionDefault)) {
      const defaultExpression =
        defaultAttribute?.args.find((arg) => arg.kind === 'positional')?.value.trim() ??
        'this function';
      diagnostics.push({
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot use an execution default ("${defaultExpression}"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.`,
        sourceId,
        span: defaultAttribute?.span ?? field.span,
      });
      continue;
    }
    if (field.optional && loweredOnCreate) {
      const generatorDescription =
        loweredOnCreate.kind === 'generator' ? `"${loweredOnCreate.id}"` : 'for this field';
      diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
        message: `Field "${model.name}.${field.name}" cannot be optional when using execution default ${generatorDescription}. Remove "?" or use a storage default.`,
        sourceId,
        span: defaultAttribute?.span ?? field.span,
      });
      continue;
    }
    const fieldUsesNamedType = namedTypeDescriptors.has(field.typeName);
    if (loweredOnCreate && !fieldUsesNamedType) {
      const generatorDescriptor = generatorDescriptorById.get(loweredOnCreate.id);
      const generatedDescriptor = generatorDescriptor?.resolveGeneratedColumnDescriptor?.({
        generated: loweredOnCreate,
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
    let isIdField = Boolean(idAttribute);
    if (idAttribute && isListField) {
      diagnostics.push({
        code: 'PSL_LIST_ID_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot be a primary key. Remove @id; a list cannot be an identity column.`,
        sourceId,
        span: idAttribute.span,
      });
      continue;
    }
    if (idAttribute && field.optional) {
      diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `Field "${model.name}.${field.name}" @id cannot be optional; primary key columns must be NOT NULL`,
        sourceId,
        span: idAttribute.span,
      });
      isIdField = false;
    }

    // Field presets contribute their own default / executionDefaults / id /
    // unique. They take precedence over attribute-derived contributions for
    // this field, since a preset *is* the field declaration. Conflicts with
    // `@default` and optional are already rejected above; explicit `@id`
    // would be redundant noise on the resolved field, so we surface it as
    // a hard error here for symmetry.
    if (presetContributions && idAttribute && !presetContributions.id) {
      diagnostics.push({
        code: 'PSL_PRESET_AND_ID_CONFLICT',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot also declare @id. Use a preset that contributes id semantics, or drop @id.`,
        sourceId,
        span: idAttribute.span,
      });
      continue;
    }

    // Field-preset contributions take precedence over attribute-derived
    // sources when present.
    const fieldExecutionDefaults =
      presetContributions?.executionDefaults ?? loweredDefault.executionDefaults;
    const fieldDefaultValue = presetContributions?.default ?? loweredDefault.defaultValue;
    resolvedFields.push({
      field,
      columnName: mappedColumnName,
      descriptor,
      nullable: presetContributions?.nullable ?? field.optional,
      ...ifDefined('defaultValue', fieldDefaultValue),
      ...ifDefined('executionDefaults', fieldExecutionDefaults),
      isId: isIdField || Boolean(presetContributions?.id),
      isUnique: Boolean(uniqueAttribute) || Boolean(presetContributions?.unique),
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
  modelEntries: readonly ModelNamespaceEntry[],
  defaultNamespaceId: string,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
): Map<string, ModelNameMapping> {
  const result = new Map<string, ModelNameMapping>();
  for (const { model, namespaceId } of modelEntries) {
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
    for (const field of Object.values(model.fields)) {
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
    result.set(modelCoordinateKey(namespaceId ?? defaultNamespaceId, model.name), {
      model,
      tableName,
      fieldColumns,
    });
  }
  return result;
}
