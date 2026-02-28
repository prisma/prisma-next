import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@prisma-next/core-control-plane/config-types';
import type {
  ParsePslDocumentResult,
  PslDefaultValue,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslSpan,
} from '@prisma-next/psl-parser';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { notOk, ok, type Result } from '@prisma-next/utils/result';

type ColumnDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeRef?: string;
};

export interface InterpretPslDocumentToSqlContractIRInput {
  readonly document: ParsePslDocumentResult;
  readonly target?: TargetPackRef<'sql', 'postgres'>;
}

const DEFAULT_POSTGRES_TARGET: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
};

const SCALAR_COLUMN_MAP: Record<string, ColumnDescriptor> = {
  String: { codecId: 'pg/text@1', nativeType: 'text' },
  Boolean: { codecId: 'pg/bool@1', nativeType: 'bool' },
  Int: { codecId: 'pg/int4@1', nativeType: 'int4' },
  BigInt: { codecId: 'pg/int8@1', nativeType: 'int8' },
  Float: { codecId: 'pg/float8@1', nativeType: 'float8' },
  Decimal: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
  DateTime: { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' },
  Json: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
};

type ResolvedField = {
  readonly field: PslField;
  readonly descriptor: ColumnDescriptor;
  readonly defaultValue?: ColumnDefault;
  readonly isId: boolean;
  readonly isUnique: boolean;
};

type DynamicTableBuilder = {
  column(
    name: string,
    options: { type: ColumnDescriptor; nullable?: true; default?: ColumnDefault },
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

function getAttribute(
  attributes: readonly PslFieldAttribute[],
  kind: PslFieldAttribute['kind'],
): PslFieldAttribute | undefined {
  return attributes.find((attribute) => attribute.kind === kind);
}

function toColumnDefault(value: PslDefaultValue): ColumnDefault {
  if (value.kind === 'function') {
    if (value.name === 'autoincrement') {
      return { kind: 'function', expression: 'autoincrement()' };
    }
    return { kind: 'function', expression: 'now()' };
  }

  return {
    kind: 'literal',
    value: value.value,
  };
}

function resolveColumnDescriptor(
  field: PslField,
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
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
  return SCALAR_COLUMN_MAP[field.typeName];
}

function collectResolvedFields(
  model: PslModel,
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
  modelNames: Set<string>,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
): ResolvedField[] {
  const resolvedFields: ResolvedField[] = [];

  for (const field of model.fields) {
    if (field.list) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_LIST',
        message: `Field "${model.name}.${field.name}" uses list types, which are not supported in SQL PSL provider v1`,
        sourceId,
        span: field.span,
      });
      continue;
    }

    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (relationAttribute && modelNames.has(field.typeName)) {
      continue;
    }

    const descriptor = resolveColumnDescriptor(field, enumTypeDescriptors, namedTypeDescriptors);
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
    const defaultValue =
      defaultAttribute?.kind === 'default' ? toColumnDefault(defaultAttribute.value) : undefined;
    resolvedFields.push({
      field,
      descriptor,
      ...(defaultValue ? { defaultValue } : {}),
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
  const diagnostics: ContractSourceDiagnostic[] = mapParserDiagnostics(input.document);
  const modelNames = new Set(input.document.ast.models.map((model) => model.name));
  const sourceId = input.document.ast.sourceId;

  let builder = defineContract().target(
    input.target ?? DEFAULT_POSTGRES_TARGET,
  ) as unknown as DynamicContractBuilder;
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();
  const namedTypeDescriptors = new Map<string, ColumnDescriptor>();

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
    if (declaration.attributes.length > 0) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTES',
        message: `Named type "${declaration.name}" attributes are not supported in SQL PSL provider v1`,
        sourceId,
        span: declaration.span,
      });
      continue;
    }

    const baseDescriptor =
      enumTypeDescriptors.get(declaration.baseType) ?? SCALAR_COLUMN_MAP[declaration.baseType];
    if (!baseDescriptor) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" references unsupported base type "${declaration.baseType}"`,
        sourceId,
        span: declaration.span,
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

  for (const model of input.document.ast.models) {
    const tableName = lowerFirst(model.name);
    const resolvedFields = collectResolvedFields(
      model,
      enumTypeDescriptors,
      namedTypeDescriptors,
      modelNames,
      diagnostics,
      sourceId,
    );

    const primaryKeyColumns = resolvedFields
      .filter((field) => field.isId)
      .map((field) => field.field.name);
    if (primaryKeyColumns.length === 0) {
      diagnostics.push({
        code: 'PSL_MISSING_PRIMARY_KEY',
        message: `Model "${model.name}" must declare at least one @id field for SQL provider`,
        sourceId,
        span: model.span,
      });
    }

    const relationAttributes = model.fields
      .map((field) => ({
        field,
        relation: getAttribute(field.attributes, 'relation'),
      }))
      .filter(
        (
          entry,
        ): entry is {
          field: PslField;
          relation: Extract<PslFieldAttribute, { kind: 'relation' }>;
        } => entry.relation?.kind === 'relation',
      );

    builder = builder.table(tableName, (tableBuilder: DynamicTableBuilder) => {
      let table = tableBuilder;

      for (const resolvedField of resolvedFields) {
        const options: {
          type: ColumnDescriptor;
          nullable?: true;
          default?: ColumnDefault;
        } = {
          type: resolvedField.descriptor,
          ...(resolvedField.field.optional ? { nullable: true as const } : {}),
          ...(resolvedField.defaultValue ? { default: resolvedField.defaultValue } : {}),
        };
        table = table.column(resolvedField.field.name, options);

        if (resolvedField.isUnique) {
          table = table.unique([resolvedField.field.name]);
        }
      }

      if (primaryKeyColumns.length > 0) {
        table = table.primaryKey(primaryKeyColumns);
      }

      for (const modelAttribute of model.attributes) {
        if (modelAttribute.kind === 'unique') {
          table = table.unique(modelAttribute.fields);
        } else if (modelAttribute.kind === 'index') {
          table = table.index(modelAttribute.fields);
        }
      }

      for (const relationAttribute of relationAttributes) {
        if (!modelNames.has(relationAttribute.field.typeName)) {
          diagnostics.push({
            code: 'PSL_INVALID_RELATION_TARGET',
            message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${relationAttribute.field.typeName}"`,
            sourceId,
            span: relationAttribute.field.span,
          });
          continue;
        }

        table = table.foreignKey(
          relationAttribute.relation.fields,
          {
            table: lowerFirst(relationAttribute.field.typeName),
            columns: relationAttribute.relation.references,
          },
          {
            ...(relationAttribute.relation.onDelete
              ? { onDelete: relationAttribute.relation.onDelete }
              : {}),
            ...(relationAttribute.relation.onUpdate
              ? { onUpdate: relationAttribute.relation.onUpdate }
              : {}),
          },
        );
      }

      return table;
    });

    builder = builder.model(model.name, tableName, (modelBuilder: DynamicModelBuilder) => {
      let next = modelBuilder;
      for (const resolvedField of resolvedFields) {
        next = next.field(resolvedField.field.name, resolvedField.field.name);
      }
      return next;
    });
  }

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
