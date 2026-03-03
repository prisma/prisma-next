import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  ParsePslDocumentResult,
  PslAttribute,
  PslField,
  PslModel,
  PslSpan,
} from '@prisma-next/psl-parser';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@prisma-next/utils/assertions';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import {
  type ControlMutationDefaults,
  type DefaultFunctionRegistry,
  lowerDefaultFunctionWithRegistry,
  type MutationDefaultGeneratorDescriptor,
  parseDefaultFunctionCall,
} from './default-function-registry';

type ColumnDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeRef?: string;
  readonly typeParams?: Record<string, unknown>;
};

export interface InterpretPslDocumentToSqlContractIRInput {
  readonly document: ParsePslDocumentResult;
  readonly target: TargetPackRef<'sql', 'postgres'>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensionPacks?: readonly string[];
  readonly controlMutationDefaults?: ControlMutationDefaults;
}

const REFERENTIAL_ACTION_MAP = {
  NoAction: 'noAction',
  Restrict: 'restrict',
  Cascade: 'cascade',
  SetNull: 'setNull',
  SetDefault: 'setDefault',
  noAction: 'noAction',
  restrict: 'restrict',
  cascade: 'cascade',
  setNull: 'setNull',
  setDefault: 'setDefault',
} as const;

type ResolvedField = {
  readonly field: PslField;
  readonly columnName: string;
  readonly descriptor: ColumnDescriptor;
  readonly defaultValue?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
  readonly isId: boolean;
  readonly isUnique: boolean;
};

type ParsedRelationAttribute = {
  readonly relationName?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  readonly onDelete?: string;
  readonly onUpdate?: string;
};

type FkRelationMetadata = {
  readonly declaringModelName: string;
  readonly declaringFieldName: string;
  readonly declaringTableName: string;
  readonly targetModelName: string;
  readonly targetTableName: string;
  readonly relationName?: string;
  readonly localColumns: readonly string[];
  readonly referencedColumns: readonly string[];
};

type ModelBackrelationCandidate = {
  readonly modelName: string;
  readonly tableName: string;
  readonly field: PslField;
  readonly targetModelName: string;
  readonly relationName?: string;
};

type ModelRelationMetadata = {
  readonly fieldName: string;
  readonly toModel: string;
  readonly toTable: string;
  readonly cardinality: '1:N' | 'N:1';
  readonly parentTable: string;
  readonly parentColumns: readonly string[];
  readonly childTable: string;
  readonly childColumns: readonly string[];
};

type ResolvedModelEntry = {
  readonly model: PslModel;
  readonly mapping: ModelNameMapping;
  readonly resolvedFields: readonly ResolvedField[];
};

function fkRelationPairKey(declaringModelName: string, targetModelName: string): string {
  // NOTE: We assume PSL model identifiers do not contain the `::` separator.
  return `${declaringModelName}::${targetModelName}`;
}

type ModelNameMapping = {
  readonly model: PslModel;
  readonly tableName: string;
  readonly fieldColumns: Map<string, string>;
};

type DynamicTableBuilder = {
  column(
    name: string,
    options: { type: ColumnDescriptor; nullable?: true; default?: ColumnDefault },
  ): DynamicTableBuilder;
  generated(
    name: string,
    options: { type: ColumnDescriptor; generated: ExecutionMutationDefaultValue },
  ): DynamicTableBuilder;
  unique(columns: readonly string[]): DynamicTableBuilder;
  primaryKey(columns: readonly string[]): DynamicTableBuilder;
  index(columns: readonly string[]): DynamicTableBuilder;
  foreignKey(
    columns: readonly string[],
    references: { table: string; columns: readonly string[] },
    options?: { onDelete?: string; onUpdate?: string },
  ): DynamicTableBuilder;
};

type DynamicModelBuilder = {
  field(name: string, column: string): DynamicModelBuilder;
  relation(
    name: string,
    options: {
      toModel: string;
      toTable: string;
      cardinality: '1:1' | '1:N' | 'N:1';
      on: {
        parentTable: string;
        parentColumns: readonly string[];
        childTable: string;
        childColumns: readonly string[];
      };
    },
  ): DynamicModelBuilder;
};

type DynamicContractBuilder = {
  target(target: TargetPackRef<'sql', 'postgres'>): DynamicContractBuilder;
  storageType(
    name: string,
    typeInstance: {
      codecId: string;
      nativeType: string;
      typeParams: Record<string, unknown>;
    },
  ): DynamicContractBuilder;
  table(
    name: string,
    callback: (tableBuilder: DynamicTableBuilder) => DynamicTableBuilder,
  ): DynamicContractBuilder;
  model(
    name: string,
    table: string,
    callback: (modelBuilder: DynamicModelBuilder) => DynamicModelBuilder,
  ): DynamicContractBuilder;
  build(): ContractIR;
};

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

function getAttribute(attributes: readonly PslAttribute[], name: string): PslAttribute | undefined {
  return attributes.find((attribute) => attribute.name === name);
}

function getNamedArgument(attribute: PslAttribute, name: string): string | undefined {
  const entry = attribute.args.find((arg) => arg.kind === 'named' && arg.name === name);
  if (!entry || entry.kind !== 'named') {
    return undefined;
  }
  return entry.value;
}

function getPositionalArgument(attribute: PslAttribute, index = 0): string | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (!entry || entry.kind !== 'positional') {
    return undefined;
  }
  return entry.value;
}

function getPositionalArgumentEntry(
  attribute: PslAttribute,
  index = 0,
): { value: string; span: PslSpan } | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (!entry || entry.kind !== 'positional') {
    return undefined;
  }
  return {
    value: entry.value,
    span: entry.span,
  };
}

function unquoteStringLiteral(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) {
    return trimmed;
  }
  return match[2] ?? '';
}

function parseQuotedStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  // This intentionally accepts either '...' or "..." and relies on PSL's
  // own string literal rules to disallow unescaped interior delimiters.
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) {
    return undefined;
  }
  return match[2] ?? '';
}

function parseFieldList(value: string): readonly string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return undefined;
  }
  const body = trimmed.slice(1, -1);
  const parts = body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts;
}

function parseDefaultLiteralValue(expression: string): ColumnDefault | undefined {
  const trimmed = expression.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return { kind: 'literal', value: trimmed === 'true' };
  }
  const numericValue = Number(trimmed);
  if (!Number.isNaN(numericValue) && trimmed.length > 0 && !/^(['"]).*\1$/.test(trimmed)) {
    return { kind: 'literal', value: numericValue };
  }
  if (/^(['"]).*\1$/.test(trimmed)) {
    return { kind: 'literal', value: unquoteStringLiteral(trimmed) };
  }
  return undefined;
}

function lowerDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly defaultAttribute: PslAttribute;
  readonly columnDescriptor: ColumnDescriptor;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly sourceId: string;
  readonly defaultFunctionRegistry: DefaultFunctionRegistry;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly defaultValue?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
} {
  const positionalEntries = input.defaultAttribute.args.filter((arg) => arg.kind === 'positional');
  const namedEntries = input.defaultAttribute.args.filter((arg) => arg.kind === 'named');

  if (namedEntries.length > 0 || positionalEntries.length !== 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: `Field "${input.modelName}.${input.fieldName}" requires exactly one positional @default(...) expression.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const expressionEntry = getPositionalArgumentEntry(input.defaultAttribute);
  if (!expressionEntry) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: `Field "${input.modelName}.${input.fieldName}" requires a positional @default(...) expression.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const literalDefault = parseDefaultLiteralValue(expressionEntry.value);
  if (literalDefault) {
    return { defaultValue: literalDefault };
  }

  const defaultFunctionCall = parseDefaultFunctionCall(expressionEntry.value, expressionEntry.span);
  if (!defaultFunctionCall) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_VALUE',
      message: `Unsupported default value "${expressionEntry.value}"`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const lowered = lowerDefaultFunctionWithRegistry({
    call: defaultFunctionCall,
    registry: input.defaultFunctionRegistry,
    context: {
      sourceId: input.sourceId,
      modelName: input.modelName,
      fieldName: input.fieldName,
      columnCodecId: input.columnDescriptor.codecId,
    },
  });

  if (!lowered.ok) {
    input.diagnostics.push(lowered.diagnostic);
    return {};
  }

  if (lowered.value.kind === 'storage') {
    return { defaultValue: lowered.value.defaultValue };
  }

  const generatorDescriptor = input.generatorDescriptorById.get(lowered.value.generated.id);
  if (!generatorDescriptor) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
      message: `Default generator "${lowered.value.generated.id}" is not available in the composed mutation default registry.`,
      sourceId: input.sourceId,
      span: expressionEntry.span,
    });
    return {};
  }

  if (!generatorDescriptor.applicableCodecIds.includes(input.columnDescriptor.codecId)) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
      message: `Default generator "${generatorDescriptor.id}" is not applicable to "${input.modelName}.${input.fieldName}" with codecId "${input.columnDescriptor.codecId}".`,
      sourceId: input.sourceId,
      span: expressionEntry.span,
    });
    return {};
  }

  return { executionDefault: lowered.value.generated };
}

function parseMapName(input: {
  readonly attribute: PslAttribute | undefined;
  readonly defaultValue: string;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly entityLabel: string;
  readonly span: PslSpan;
}): string {
  if (!input.attribute) {
    return input.defaultValue;
  }

  const value = getPositionalArgument(input.attribute);
  if (!value) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} @map requires a positional quoted string literal argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return input.defaultValue;
  }
  const parsed = parseQuotedStringLiteral(value);
  if (parsed === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} @map requires a positional quoted string literal argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return input.defaultValue;
  }
  return parsed;
}

function parsePgvectorLength(input: {
  readonly attribute: PslAttribute;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): number | undefined {
  const namedLength = getNamedArgument(input.attribute, 'length');
  const namedDim = getNamedArgument(input.attribute, 'dim');
  const positional = getPositionalArgument(input.attribute);
  const raw = namedLength ?? namedDim ?? positional;
  if (!raw) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: '@pgvector.column requires length/dim argument',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const parsed = Number(unquoteStringLiteral(raw));
  if (!Number.isInteger(parsed) || parsed < 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: '@pgvector.column length/dim must be a positive integer',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  return parsed;
}

function resolveColumnDescriptor(
  field: PslField,
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
  scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
): ColumnDescriptor | undefined {
  if (field.typeRef && namedTypeDescriptors.has(field.typeRef)) {
    return namedTypeDescriptors.get(field.typeRef);
  }
  if (namedTypeDescriptors.has(field.typeName)) {
    return namedTypeDescriptors.get(field.typeName);
  }
  if (enumTypeDescriptors.has(field.typeName)) {
    return enumTypeDescriptors.get(field.typeName);
  }
  return scalarTypeDescriptors.get(field.typeName);
}

function collectResolvedFields(
  model: PslModel,
  mapping: ModelNameMapping,
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeBaseTypes: Map<string, string>,
  modelNames: Set<string>,
  composedExtensions: Set<string>,
  defaultFunctionRegistry: DefaultFunctionRegistry,
  generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
  scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
): ResolvedField[] {
  const resolvedFields: ResolvedField[] = [];

  for (const field of model.fields) {
    if (field.list) {
      if (modelNames.has(field.typeName)) {
        continue;
      }
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_LIST',
        message: `Field "${model.name}.${field.name}" uses a scalar/storage list type, which is not supported in SQL PSL provider v1. Model-typed lists are only supported as backrelation navigation fields when they match an FK-side relation.`,
        sourceId,
        span: field.span,
      });
      continue;
    }

    for (const attribute of field.attributes) {
      if (
        attribute.name === 'id' ||
        attribute.name === 'unique' ||
        attribute.name === 'default' ||
        attribute.name === 'relation' ||
        attribute.name === 'map' ||
        attribute.name === 'pgvector.column'
      ) {
        continue;
      }
      if (attribute.name.startsWith('pgvector.') && !composedExtensions.has('pgvector')) {
        diagnostics.push({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: `Attribute "@${attribute.name}" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensionPacks in prisma-next.config.ts.`,
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

    let descriptor = resolveColumnDescriptor(
      field,
      enumTypeDescriptors,
      namedTypeDescriptors,
      scalarTypeDescriptors,
    );
    const pgvectorColumnAttribute = getAttribute(field.attributes, 'pgvector.column');
    if (pgvectorColumnAttribute) {
      if (!composedExtensions.has('pgvector')) {
        diagnostics.push({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message:
            'Attribute "@pgvector.column" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensionPacks in prisma-next.config.ts.',
          sourceId,
          span: pgvectorColumnAttribute.span,
        });
      } else {
        const isBytesBase =
          field.typeName === 'Bytes' ||
          namedTypeBaseTypes.get(field.typeRef ?? field.typeName) === 'Bytes';
        if (!isBytesBase) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Field "${model.name}.${field.name}" uses @pgvector.column on unsupported base type "${field.typeName}"`,
            sourceId,
            span: pgvectorColumnAttribute.span,
          });
        } else {
          const length = parsePgvectorLength({
            attribute: pgvectorColumnAttribute,
            diagnostics,
            sourceId,
          });
          if (length !== undefined) {
            descriptor = {
              codecId: 'pg/vector@1',
              nativeType: `vector(${length})`,
              typeParams: { length },
            };
          }
        }
      }
    }

    if (!descriptor) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
        sourceId,
        span: field.span,
      });
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
    resolvedFields.push({
      field,
      columnName: mappedColumnName,
      descriptor,
      ...ifDefined('defaultValue', loweredDefault.defaultValue),
      ...ifDefined('executionDefault', loweredDefault.executionDefault),
      isId: Boolean(getAttribute(field.attributes, 'id')),
      isUnique: Boolean(getAttribute(field.attributes, 'unique')),
    });
  }

  return resolvedFields;
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

function indexFkRelations(input: { readonly fkRelationMetadata: readonly FkRelationMetadata[] }): {
  readonly modelRelations: Map<string, ModelRelationMetadata[]>;
  readonly fkRelationsByPair: Map<string, FkRelationMetadata[]>;
} {
  const modelRelations = new Map<string, ModelRelationMetadata[]>();
  const fkRelationsByPair = new Map<string, FkRelationMetadata[]>();

  for (const relation of input.fkRelationMetadata) {
    const existing = modelRelations.get(relation.declaringModelName);
    const current = existing ?? [];
    if (!existing) {
      modelRelations.set(relation.declaringModelName, current);
    }
    current.push({
      fieldName: relation.declaringFieldName,
      toModel: relation.targetModelName,
      toTable: relation.targetTableName,
      cardinality: 'N:1',
      parentTable: relation.declaringTableName,
      parentColumns: relation.localColumns,
      childTable: relation.targetTableName,
      childColumns: relation.referencedColumns,
    });

    const pairKey = fkRelationPairKey(relation.declaringModelName, relation.targetModelName);
    const pairRelations = fkRelationsByPair.get(pairKey);
    if (!pairRelations) {
      fkRelationsByPair.set(pairKey, [relation]);
      continue;
    }
    pairRelations.push(relation);
  }

  return { modelRelations, fkRelationsByPair };
}

function applyBackrelationCandidates(input: {
  readonly backrelationCandidates: readonly ModelBackrelationCandidate[];
  readonly fkRelationsByPair: Map<string, readonly FkRelationMetadata[]>;
  readonly modelRelations: Map<string, ModelRelationMetadata[]>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): void {
  for (const candidate of input.backrelationCandidates) {
    const pairKey = fkRelationPairKey(candidate.targetModelName, candidate.modelName);
    const pairMatches = input.fkRelationsByPair.get(pairKey) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((relation) => relation.relationName === candidate.relationName)
      : [...pairMatches];

    if (matches.length === 0) {
      input.diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION_LIST',
        message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" has no matching FK-side relation on model "${candidate.targetModelName}". Add @relation(fields: [...], references: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
        sourceId: input.sourceId,
        span: candidate.field.span,
      });
      continue;
    }
    if (matches.length > 1) {
      input.diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
        message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" matches multiple FK-side relations on model "${candidate.targetModelName}". Add @relation(name: "...") (or @relation("...")) to both sides to disambiguate.`,
        sourceId: input.sourceId,
        span: candidate.field.span,
      });
      continue;
    }

    invariant(matches.length === 1, 'Backrelation matching requires exactly one match');
    const matched = matches[0];
    assertDefined(matched, 'Backrelation matching requires a defined relation match');

    const existing = input.modelRelations.get(candidate.modelName);
    const current = existing ?? [];
    if (!existing) {
      input.modelRelations.set(candidate.modelName, current);
    }
    current.push({
      fieldName: candidate.field.name,
      toModel: matched.declaringModelName,
      toTable: matched.declaringTableName,
      cardinality: '1:N',
      parentTable: candidate.tableName,
      parentColumns: matched.referencedColumns,
      childTable: matched.declaringTableName,
      childColumns: matched.localColumns,
    });
  }
}

function emitModelsWithRelations(input: {
  readonly builder: DynamicContractBuilder;
  readonly resolvedModels: ResolvedModelEntry[];
  readonly modelRelations: Map<string, readonly ModelRelationMetadata[]>;
}): DynamicContractBuilder {
  let nextBuilder = input.builder;

  const sortedModels = input.resolvedModels.sort((left, right) => {
    const tableComparison = compareStrings(left.mapping.tableName, right.mapping.tableName);
    if (tableComparison === 0) {
      return compareStrings(left.model.name, right.model.name);
    }
    return tableComparison;
  });

  for (const entry of sortedModels) {
    const relationEntries = [...(input.modelRelations.get(entry.model.name) ?? [])].sort(
      (left, right) => compareStrings(left.fieldName, right.fieldName),
    );
    nextBuilder = nextBuilder.model(
      entry.model.name,
      entry.mapping.tableName,
      (modelBuilder: DynamicModelBuilder) => {
        let next = modelBuilder;
        for (const resolvedField of entry.resolvedFields) {
          next = next.field(resolvedField.field.name, resolvedField.columnName);
        }
        for (const relation of relationEntries) {
          next = next.relation(relation.fieldName, {
            toModel: relation.toModel,
            toTable: relation.toTable,
            cardinality: relation.cardinality,
            on: {
              parentTable: relation.parentTable,
              parentColumns: relation.parentColumns,
              childTable: relation.childTable,
              childColumns: relation.childColumns,
            },
          });
        }
        return next;
      },
    );
  }

  return nextBuilder;
}

function mapParserDiagnostics(document: ParsePslDocumentResult): ContractSourceDiagnostic[] {
  return document.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId: diagnostic.sourceId,
    span: diagnostic.span,
  }));
}

function normalizeReferentialAction(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly actionName: 'onDelete' | 'onUpdate';
  readonly actionToken: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string | undefined {
  const normalized =
    REFERENTIAL_ACTION_MAP[input.actionToken as keyof typeof REFERENTIAL_ACTION_MAP];
  if (normalized) {
    return normalized;
  }

  input.diagnostics.push({
    code: 'PSL_UNSUPPORTED_REFERENTIAL_ACTION',
    message: `Relation field "${input.modelName}.${input.fieldName}" has unsupported ${input.actionName} action "${input.actionToken}"`,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

function parseAttributeFieldList(input: {
  readonly attribute: PslAttribute;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly code: string;
  readonly messagePrefix: string;
}): readonly string[] | undefined {
  const raw = getNamedArgument(input.attribute, 'fields') ?? getPositionalArgument(input.attribute);
  if (!raw) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.messagePrefix} requires fields list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const fields = parseFieldList(raw);
  if (!fields || fields.length === 0) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.messagePrefix} requires bracketed field list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  return fields;
}

function mapFieldNamesToColumns(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly mapping: ModelNameMapping;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly span: PslSpan;
  readonly contextLabel: string;
}): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of input.fieldNames) {
    const columnName = input.mapping.fieldColumns.get(fieldName);
    if (!columnName) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${input.contextLabel} references unknown field "${input.modelName}.${fieldName}"`,
        sourceId: input.sourceId,
        span: input.span,
      });
      return undefined;
    }
    columns.push(columnName);
  }
  return columns;
}

function buildModelMappings(
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

function validateNavigationListFieldAttributes(input: {
  readonly modelName: string;
  readonly field: PslField;
  readonly sourceId: string;
  readonly composedExtensions: Set<string>;
  readonly diagnostics: ContractSourceDiagnostic[];
}): boolean {
  let valid = true;
  for (const attribute of input.field.attributes) {
    if (attribute.name === 'relation') {
      continue;
    }
    if (attribute.name.startsWith('pgvector.') && !input.composedExtensions.has('pgvector')) {
      input.diagnostics.push({
        code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
        message: `Attribute "@${attribute.name}" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensionPacks in prisma-next.config.ts.`,
        sourceId: input.sourceId,
        span: attribute.span,
      });
      valid = false;
      continue;
    }
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Field "${input.modelName}.${input.field.name}" uses unsupported attribute "@${attribute.name}"`,
      sourceId: input.sourceId,
      span: attribute.span,
    });
    valid = false;
  }
  return valid;
}

function parseRelationAttribute(input: {
  readonly attribute: PslAttribute;
  readonly modelName: string;
  readonly fieldName: string;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ParsedRelationAttribute | undefined {
  const positionalEntries = input.attribute.args.filter((arg) => arg.kind === 'positional');
  if (positionalEntries.length > 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" has too many positional arguments`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  let relationNameFromPositional: string | undefined;
  const positionalNameEntry = getPositionalArgumentEntry(input.attribute);
  if (positionalNameEntry) {
    const parsedName = parseQuotedStringLiteral(positionalNameEntry.value);
    if (!parsedName) {
      input.diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${input.modelName}.${input.fieldName}" positional relation name must be a quoted string literal`,
        sourceId: input.sourceId,
        span: positionalNameEntry.span,
      });
      return undefined;
    }
    relationNameFromPositional = parsedName;
  }

  for (const arg of input.attribute.args) {
    if (arg.kind === 'positional') {
      continue;
    }
    if (
      arg.name !== 'name' &&
      arg.name !== 'fields' &&
      arg.name !== 'references' &&
      arg.name !== 'onDelete' &&
      arg.name !== 'onUpdate'
    ) {
      input.diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${input.modelName}.${input.fieldName}" has unsupported argument "${arg.name}"`,
        sourceId: input.sourceId,
        span: arg.span,
      });
      return undefined;
    }
  }

  const namedRelationNameRaw = getNamedArgument(input.attribute, 'name');
  const namedRelationName = namedRelationNameRaw
    ? parseQuotedStringLiteral(namedRelationNameRaw)
    : undefined;
  if (namedRelationNameRaw && !namedRelationName) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" named relation name must be a quoted string literal`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  if (
    relationNameFromPositional &&
    namedRelationName &&
    relationNameFromPositional !== namedRelationName
  ) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" has conflicting positional and named relation names`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const relationName = namedRelationName ?? relationNameFromPositional;

  const fieldsRaw = getNamedArgument(input.attribute, 'fields');
  const referencesRaw = getNamedArgument(input.attribute, 'references');
  if ((fieldsRaw && !referencesRaw) || (!fieldsRaw && referencesRaw)) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" requires fields and references arguments`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  let fields: readonly string[] | undefined;
  let references: readonly string[] | undefined;
  if (fieldsRaw && referencesRaw) {
    const parsedFields = parseFieldList(fieldsRaw);
    const parsedReferences = parseFieldList(referencesRaw);
    if (
      !parsedFields ||
      !parsedReferences ||
      parsedFields.length === 0 ||
      parsedReferences.length === 0
    ) {
      input.diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${input.modelName}.${input.fieldName}" requires bracketed fields and references lists`,
        sourceId: input.sourceId,
        span: input.attribute.span,
      });
      return undefined;
    }
    fields = parsedFields;
    references = parsedReferences;
  }

  const onDeleteArgument = getNamedArgument(input.attribute, 'onDelete');
  const onUpdateArgument = getNamedArgument(input.attribute, 'onUpdate');

  return {
    ...ifDefined('relationName', relationName),
    ...ifDefined('fields', fields),
    ...ifDefined('references', references),
    ...ifDefined('onDelete', onDeleteArgument ? unquoteStringLiteral(onDeleteArgument) : undefined),
    ...ifDefined('onUpdate', onUpdateArgument ? unquoteStringLiteral(onUpdateArgument) : undefined),
  };
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

  let builder = defineContract().target(input.target) as unknown as DynamicContractBuilder;
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();
  const namedTypeDescriptors = new Map<string, ColumnDescriptor>();
  const namedTypeBaseTypes = new Map<string, string>();

  for (const enumDeclaration of input.document.ast.enums) {
    const nativeType = enumDeclaration.name.toLowerCase();
    const descriptor: ColumnDescriptor = {
      codecId: 'pg/enum@1',
      nativeType,
      typeRef: enumDeclaration.name,
    };
    enumTypeDescriptors.set(enumDeclaration.name, descriptor);
    builder = builder.storageType(enumDeclaration.name, {
      codecId: 'pg/enum@1',
      nativeType,
      typeParams: { values: enumDeclaration.values.map((value) => value.name) },
    });
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
    const unsupportedNamedTypeAttribute = declaration.attributes.find(
      (attribute) => attribute.name !== 'pgvector.column',
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
      namedTypeDescriptors.set(declaration.name, {
        codecId: 'pg/vector@1',
        nativeType: `vector(${length})`,
        typeRef: declaration.name,
      });
      builder = builder.storageType(declaration.name, {
        codecId: 'pg/vector@1',
        nativeType: `vector(${length})`,
        typeParams: { length },
      });
      continue;
    }

    const descriptor: ColumnDescriptor = {
      codecId: baseDescriptor.codecId,
      nativeType: baseDescriptor.nativeType,
      typeRef: declaration.name,
    };
    namedTypeDescriptors.set(declaration.name, descriptor);
    builder = builder.storageType(declaration.name, {
      codecId: baseDescriptor.codecId,
      nativeType: baseDescriptor.nativeType,
      typeParams: {},
    });
  }

  const modelMappings = buildModelMappings(input.document.ast.models, diagnostics, sourceId);
  const resolvedModels: Array<{
    model: PslModel;
    mapping: ModelNameMapping;
    resolvedFields: ResolvedField[];
  }> = [];
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
      defaultFunctionRegistry,
      generatorDescriptorById,
      diagnostics,
      sourceId,
      input.scalarTypeDescriptors,
    );
    resolvedModels.push({ model, mapping, resolvedFields });

    const primaryKeyColumns = resolvedFields
      .filter((field) => field.isId)
      .map((field) => field.columnName);
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

    builder = builder.table(tableName, (tableBuilder: DynamicTableBuilder) => {
      let table = tableBuilder;

      for (const resolvedField of resolvedFields) {
        if (resolvedField.executionDefault) {
          table = table.generated(resolvedField.columnName, {
            type: resolvedField.descriptor,
            generated: resolvedField.executionDefault,
          });
        } else {
          const options: {
            type: ColumnDescriptor;
            nullable?: true;
            default?: ColumnDefault;
          } = {
            type: resolvedField.descriptor,
            ...ifDefined('nullable', resolvedField.field.optional ? (true as const) : undefined),
            ...ifDefined('default', resolvedField.defaultValue),
          };
          table = table.column(resolvedField.columnName, options);
        }

        if (resolvedField.isUnique) {
          table = table.unique([resolvedField.columnName]);
        }
      }

      if (primaryKeyColumns.length > 0) {
        table = table.primaryKey(primaryKeyColumns);
      }

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
          if (modelAttribute.name === 'unique') {
            table = table.unique(columnNames);
          } else {
            table = table.index(columnNames);
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

        table = table.foreignKey(
          localColumns,
          {
            table: targetMapping.tableName,
            columns: referencedColumns,
          },
          {
            ...ifDefined('onDelete', onDelete),
            ...ifDefined('onUpdate', onUpdate),
          },
        );

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

      return table;
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
  builder = emitModelsWithRelations({
    builder,
    resolvedModels,
    modelRelations,
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

  const contract = builder.build() as ContractIR;
  return ok(contract);
}
