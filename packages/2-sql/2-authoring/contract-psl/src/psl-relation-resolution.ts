import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { PslAttribute, PslField, PslSpan } from '@prisma-next/psl-parser';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import type { SqlSemanticRelationNode } from '@prisma-next/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@prisma-next/utils/assertions';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  getNamedArgument,
  getPositionalArgumentEntry,
  parseFieldList,
  parseQuotedStringLiteral,
  unquoteStringLiteral,
} from './psl-attribute-parsing';

export const REFERENTIAL_ACTION_MAP = {
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

export type ParsedRelationAttribute = {
  readonly relationName?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  readonly constraintName?: string;
  readonly onDelete?: string;
  readonly onUpdate?: string;
};

export type FkRelationMetadata = {
  readonly declaringModelName: string;
  readonly declaringFieldName: string;
  readonly declaringTableName: string;
  readonly targetModelName: string;
  readonly targetTableName: string;
  readonly relationName?: string;
  readonly localColumns: readonly string[];
  readonly referencedColumns: readonly string[];
};

export type ModelBackrelationCandidate = {
  readonly modelName: string;
  readonly tableName: string;
  readonly field: PslField;
  readonly targetModelName: string;
  readonly relationName?: string;
};

type ModelRelationMetadata = SqlSemanticRelationNode;

export function fkRelationPairKey(declaringModelName: string, targetModelName: string): string {
  // NOTE: We assume PSL model identifiers do not contain the `::` separator.
  return `${declaringModelName}::${targetModelName}`;
}

export function normalizeReferentialAction(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly actionName: 'onDelete' | 'onUpdate';
  readonly actionToken: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ReferentialAction | undefined {
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

export function parseRelationAttribute(input: {
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
      arg.name !== 'map' &&
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

  const constraintNameRaw = getNamedArgument(input.attribute, 'map');
  const constraintName = constraintNameRaw
    ? parseQuotedStringLiteral(constraintNameRaw)
    : undefined;
  if (constraintNameRaw && !constraintName) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" map argument must be a quoted string literal`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

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
    ...ifDefined('constraintName', constraintName),
    ...ifDefined('onDelete', onDeleteArgument ? unquoteStringLiteral(onDeleteArgument) : undefined),
    ...ifDefined('onUpdate', onUpdateArgument ? unquoteStringLiteral(onUpdateArgument) : undefined),
  };
}

export function indexFkRelations(input: {
  readonly fkRelationMetadata: readonly FkRelationMetadata[];
}): {
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
      on: {
        parentTable: relation.declaringTableName,
        parentColumns: relation.localColumns,
        childTable: relation.targetTableName,
        childColumns: relation.referencedColumns,
      },
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

export function applyBackrelationCandidates(input: {
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
      on: {
        parentTable: candidate.tableName,
        parentColumns: matched.referencedColumns,
        childTable: matched.declaringTableName,
        childColumns: matched.localColumns,
      },
    });
  }
}

export function validateNavigationListFieldAttributes(input: {
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
