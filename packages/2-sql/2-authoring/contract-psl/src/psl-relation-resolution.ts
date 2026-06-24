import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { FieldSymbol, ModelSymbol, PslSpan, ResolvedAttribute } from '@prisma-next/psl-parser';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import type { RelationNode } from '@prisma-next/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@prisma-next/utils/assertions';
import { ifDefined } from '@prisma-next/utils/defined';

import {
  getAttribute,
  getNamedArgument,
  getPositionalArgument,
  getPositionalArgumentEntry,
  parseFieldList,
  parseQuotedStringLiteral,
  unquoteStringLiteral,
} from './psl-attribute-parsing';
import { checkUncomposedNamespace, reportUncomposedNamespace } from './psl-column-resolution';

export const REFERENTIAL_ACTION_MAP: Record<string, ReferentialAction | undefined> = {
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
};

/**
 * The junction named by `through:`. The junction is the head of the value, so a
 * qualified `through: Follow.follower` splits into `junction: 'Follow'` and the
 * optional pin `field: 'follower'`.
 */
export type ParsedThrough = {
  readonly junction: string;
  readonly field?: string;
};

export type ParsedRelationAttribute = {
  readonly relationName?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  /**
   * Set when local FK fields are declared (`from:`/`fields:`) but the
   * referenced key is omitted (`to:`/`references:` absent). The caller resolves
   * the referenced columns from the target model's `@id`. `references` stays
   * undefined in this case; the two never co-occur.
   */
  readonly referencesInferred?: true;
  /**
   * The junction named by `through:` on a navigable list field, used to
   * recognise the many-to-many via that explicit junction. `junction` is the
   * head identifier (`through: PostTag`); `field` is the optional relation-field
   * segment of the qualified form (`through: PostTag.post` ⇒ `field: 'post'`),
   * which pins the parent-side junction FK to disambiguate self-relations and
   * multiple many-to-many between the same pair of models.
   */
  readonly through?: ParsedThrough;
  readonly constraintName?: string;
  readonly onDelete?: string;
  readonly onUpdate?: string;
};

/**
 * Parses a single `@relation` directional argument value (`from:`/`to:` or
 * their legacy `fields:`/`references:` aliases). A single field may be bare
 * (`from: userId`) or bracketed (`from: [userId]`); composites must be
 * bracketed (`from: [a, b]`).
 *
 * A redundant model qualifier on `to:` (`to: Post.id`) is stripped to its bare
 * column name so it lowers identically to the unqualified spelling. The parser
 * carries the full dotted value, so `stripModelQualifier` keeps the segment
 * after the qualifying `Model.` — correct for `from:`/`to:`, where the column
 * is the tail. `through:` is the opposite shape (the junction is the head) and
 * is parsed separately in `parseThroughArgument`.
 */
function parseRelationFieldArgument(raw: string): readonly string[] | undefined {
  const trimmed = raw.trim();
  const entries = trimmed.startsWith('[') ? parseFieldList(trimmed) : [trimmed];
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const stripped = entries.map(stripModelQualifier);
  if (stripped.some((entry) => entry.length === 0)) {
    return undefined;
  }
  return stripped;
}

/** Drops a leading `Model.` qualifier, leaving the bare field name. */
function stripModelQualifier(entry: string): string {
  const dotIndex = entry.lastIndexOf('.');
  return dotIndex === -1 ? entry : entry.slice(dotIndex + 1).trim();
}

/**
 * Splits a `through:` value into its junction head and optional relation-field
 * pin. `through: Follow.follower` ⇒ `{ junction: 'Follow', field: 'follower' }`;
 * `through: PostTag` ⇒ `{ junction: 'PostTag' }`. Returns undefined when the
 * junction segment is empty.
 */
function parseThroughArgument(raw: string): ParsedThrough | undefined {
  const trimmed = raw.trim();
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) {
    return trimmed.length > 0 ? { junction: trimmed } : undefined;
  }
  const junction = trimmed.slice(0, dotIndex).trim();
  const field = trimmed.slice(dotIndex + 1).trim();
  if (junction.length === 0) {
    return undefined;
  }
  return { junction, ...ifDefined('field', field.length > 0 ? field : undefined) };
}

export type FkRelationMetadata = {
  readonly declaringModelName: string;
  readonly declaringFieldName: string;
  readonly declaringTableName: string;
  /** Resolved namespace coordinate of the declaring model, when known. */
  readonly declaringNamespaceId?: string;
  readonly targetModelName: string;
  readonly targetTableName: string;
  /** Resolved namespace coordinate of the related model, when known. */
  readonly targetNamespaceId?: string;
  readonly relationName?: string;
  readonly localColumns: readonly string[];
  readonly referencedColumns: readonly string[];
};

export type ModelBackrelationCandidate = {
  readonly modelName: string;
  readonly tableName: string;
  readonly field: FieldSymbol;
  readonly targetModelName: string;
  readonly relationName?: string;
  /**
   * The junction named by `through:` on the list field. When present,
   * many-to-many recognition considers only `junction` rather than scanning
   * every junction-shaped model linking the two sides; an optional `field` pins
   * the parent-side junction FK by its relation field, disambiguating
   * self-relations and multiple many-to-many between the same pair of models.
   */
  readonly through?: ParsedThrough;
};

type ModelRelationMetadata = RelationNode;

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
  const normalized = REFERENTIAL_ACTION_MAP[input.actionToken];
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
  readonly attribute: ResolvedAttribute;
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
      arg.name !== 'from' &&
      arg.name !== 'to' &&
      arg.name !== 'through' &&
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

  // `from:`/`to:` are the canonical local-fields/referenced-key arguments;
  // legacy `fields:`/`references:` are accepted as input aliases that lower to
  // the same result. The two spellings are never mixed on one relation.
  const fromRaw =
    getNamedArgument(input.attribute, 'from') ?? getNamedArgument(input.attribute, 'fields');
  const toRaw =
    getNamedArgument(input.attribute, 'to') ?? getNamedArgument(input.attribute, 'references');
  if (!fromRaw && toRaw) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" requires a from argument naming the local foreign-key field(s)`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  let fields: readonly string[] | undefined;
  let references: readonly string[] | undefined;
  let referencesInferred: true | undefined;
  if (fromRaw) {
    const parsedFields = parseRelationFieldArgument(fromRaw);
    if (!parsedFields) {
      input.diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${input.modelName}.${input.fieldName}" requires a bare field or bracketed list for from`,
        sourceId: input.sourceId,
        span: input.attribute.span,
      });
      return undefined;
    }
    fields = parsedFields;

    if (toRaw) {
      const parsedReferences = parseRelationFieldArgument(toRaw);
      if (!parsedReferences) {
        input.diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${input.modelName}.${input.fieldName}" requires a bare field or bracketed list for to`,
          sourceId: input.sourceId,
          span: input.attribute.span,
        });
        return undefined;
      }
      references = parsedReferences;
    } else {
      // `to:` omitted ⇒ the referenced columns default to the target model's
      // `@id`. The caller, which holds the target model, resolves them.
      referencesInferred = true;
    }
  }

  // `through:` names the junction for a navigable many-to-many list field. The
  // junction is the head of the value: a bare `through: PostTag` names the
  // junction alone, while a qualified `through: PostTag.post` additionally pins
  // the parent-side junction FK by its relation field. The junction is the
  // segment before the first `.`; the optional `field` is the segment after.
  const throughRaw = getNamedArgument(input.attribute, 'through');
  const through = throughRaw ? parseThroughArgument(throughRaw) : undefined;

  const onDeleteArgument = getNamedArgument(input.attribute, 'onDelete');
  const onUpdateArgument = getNamedArgument(input.attribute, 'onUpdate');

  return {
    ...ifDefined('relationName', relationName),
    ...ifDefined('fields', fields),
    ...ifDefined('references', references),
    ...ifDefined('referencesInferred', referencesInferred),
    ...ifDefined('through', through),
    ...ifDefined('constraintName', constraintName),
    ...ifDefined('onDelete', onDeleteArgument ? unquoteStringLiteral(onDeleteArgument) : undefined),
    ...ifDefined('onUpdate', onUpdateArgument ? unquoteStringLiteral(onUpdateArgument) : undefined),
  };
}

/**
 * Resolves a model's `@id` field names in declaration order — an inline `@id`
 * on a single field, or a model-level `@@id([...])` list. Returns undefined
 * when the model declares no identity, which is what makes an omitted `to:`
 * un-inferable for a relation targeting it.
 */
export function resolveTargetIdFieldNames(model: ModelSymbol): readonly string[] | undefined {
  const blockId = getAttribute(model.attributes, 'id');
  if (blockId) {
    const raw = getNamedArgument(blockId, 'fields') ?? getPositionalArgument(blockId);
    const fields = raw ? parseFieldList(raw) : undefined;
    if (fields && fields.length > 0) {
      return fields;
    }
    return undefined;
  }

  const inlineIdFields = Object.values(model.fields).filter((field) =>
    field.attributes.some((attribute) => attribute.name === 'id'),
  );
  if (inlineIdFields.length === 1) {
    const idField = inlineIdFields[0];
    return idField ? [idField.name] : undefined;
  }
  return undefined;
}

export function indexFkRelations(input: {
  readonly fkRelationMetadata: readonly FkRelationMetadata[];
}): {
  readonly modelRelations: Map<string, ModelRelationMetadata[]>;
  readonly fkRelationsByPair: Map<string, FkRelationMetadata[]>;
  readonly fkRelationsByDeclaringModel: Map<string, FkRelationMetadata[]>;
} {
  const modelRelations = new Map<string, ModelRelationMetadata[]>();
  const fkRelationsByPair = new Map<string, FkRelationMetadata[]>();
  const fkRelationsByDeclaringModel = new Map<string, FkRelationMetadata[]>();

  for (const relation of input.fkRelationMetadata) {
    const declaringFkRelations = fkRelationsByDeclaringModel.get(relation.declaringModelName);
    if (declaringFkRelations) {
      declaringFkRelations.push(relation);
    } else {
      fkRelationsByDeclaringModel.set(relation.declaringModelName, [relation]);
    }

    const existing = modelRelations.get(relation.declaringModelName);
    const current = existing ?? [];
    if (!existing) {
      modelRelations.set(relation.declaringModelName, current);
    }
    current.push({
      fieldName: relation.declaringFieldName,
      toModel: relation.targetModelName,
      toTable: relation.targetTableName,
      ...ifDefined('toNamespaceId', relation.targetNamespaceId),
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

  return { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel };
}

type JunctionFkPair = {
  readonly parentFk: FkRelationMetadata;
  readonly childFk: FkRelationMetadata;
  /**
   * The child FK's junction columns reordered to the target model's
   * id-column order, so positional pairing against the target id stays
   * faithful to the authored references regardless of declaration order.
   */
  readonly childColumnsInTargetIdOrder: readonly string[];
};

function idColumnsAreExactlyFkPair(
  idColumns: readonly string[],
  parentColumns: readonly string[],
  childColumns: readonly string[],
): boolean {
  if (idColumns.length !== parentColumns.length + childColumns.length) {
    return false;
  }
  const fkColumns = new Set([...parentColumns, ...childColumns]);
  if (fkColumns.size !== parentColumns.length + childColumns.length) {
    return false;
  }
  return idColumns.every((column) => fkColumns.has(column));
}

/**
 * Reorders the child FK's junction columns into the target model's id-column
 * order. Returns undefined unless the FK references exactly the target's full
 * id, because downstream consumers pair `through.childColumns` positionally
 * against the target id columns — an FK referencing anything else (a non-id
 * unique, a partial id) would produce a silently wrong join.
 */
function childColumnsInTargetIdOrder(
  childFk: FkRelationMetadata,
  targetIdColumns: readonly string[],
): readonly string[] | undefined {
  if (childFk.referencedColumns.length !== targetIdColumns.length) {
    return undefined;
  }
  const localByReferenced = new Map<string, string>();
  for (const [index, referencedColumn] of childFk.referencedColumns.entries()) {
    const localColumn = childFk.localColumns[index];
    if (localColumn === undefined) {
      return undefined;
    }
    localByReferenced.set(referencedColumn, localColumn);
  }
  if (localByReferenced.size !== targetIdColumns.length) {
    return undefined;
  }
  const ordered: string[] = [];
  for (const idColumn of targetIdColumns) {
    const localColumn = localByReferenced.get(idColumn);
    if (localColumn === undefined) {
      return undefined;
    }
    ordered.push(localColumn);
  }
  return ordered;
}

/**
 * A model that carries an FK back to the candidate's model and an FK to the
 * candidate's target model — i.e. it is junction-shaped for this candidate —
 * but was declined as a many-to-many junction. The reason drives a
 * junction-specific diagnostic that is more actionable than the generic
 * orphaned-backrelation message.
 */
type JunctionNearMiss =
  | {
      readonly junctionModelName: string;
      readonly reason: 'id-not-fk-covering' | 'target-fk-not-id';
    }
  | {
      readonly junctionModelName: string;
      readonly reason: 'through-field-not-fk';
      readonly throughField: string;
    };

/**
 * Finds explicit junction models that connect a bare backrelation list field
 * to its target model: a model whose composite id columns are exactly the FK
 * columns of one relation back to the candidate's model (the parent side) and
 * one relation to the candidate's target model (the child side). The child
 * FK must reference exactly the target model's id columns; its junction
 * columns are carried in target-id order on the pair. A relation name on the
 * list field, or a `through: Junction.relationField` pin, fixes the parent-side
 * FK relation, which is how self-referential many-to-many sides and multiple
 * many-to-many between the same pair of models are disambiguated.
 *
 * Alongside the recognised pairs, returns junction-shaped near-misses (models
 * that link both sides but were declined) so the caller can emit a
 * junction-specific diagnostic instead of the generic orphaned-list message.
 * A `through:` pin naming a field that is not a parent-side junction FK back to
 * the candidate is itself reported as a near-miss.
 */
function findJunctionFkPairs(input: {
  readonly candidate: ModelBackrelationCandidate;
  readonly fkRelationsByDeclaringModel: ReadonlyMap<string, readonly FkRelationMetadata[]>;
  readonly modelIdColumns: ReadonlyMap<string, readonly string[]>;
}): { readonly pairs: JunctionFkPair[]; readonly nearMisses: JunctionNearMiss[] } {
  const targetIdColumns = input.modelIdColumns.get(input.candidate.targetModelName);
  if (!targetIdColumns || targetIdColumns.length === 0) {
    return { pairs: [], nearMisses: [] };
  }
  const through = input.candidate.through;
  const pairs: JunctionFkPair[] = [];
  const nearMisses: JunctionNearMiss[] = [];
  for (const [junctionModelName, junctionFks] of input.fkRelationsByDeclaringModel) {
    // An explicit `through:` names the junction directly: skip every other
    // junction-shaped model so recognition and near-miss reporting are scoped
    // to the authored junction. A bare list (no `through:`) scans all of them.
    if (through !== undefined && junctionModelName !== through.junction) {
      continue;
    }
    const idColumns = input.modelIdColumns.get(junctionModelName);
    // A `through: Junction.relationField` pin names a parent-side junction FK by
    // its relation field. If the named junction has no such FK back to the
    // candidate, the pin cannot resolve: record it as an actionable near-miss
    // rather than letting recognition fall into the generic ambiguity path.
    if (through?.field !== undefined) {
      const pinnedParentFkExists = junctionFks.some(
        (fk) =>
          fk.targetModelName === input.candidate.modelName &&
          fk.declaringFieldName === through.field,
      );
      if (!pinnedParentFkExists) {
        nearMisses.push({
          junctionModelName,
          reason: 'through-field-not-fk',
          throughField: through.field,
        });
        continue;
      }
    }
    for (const parentFk of junctionFks) {
      if (parentFk.targetModelName !== input.candidate.modelName) {
        continue;
      }
      if (
        input.candidate.relationName !== undefined &&
        parentFk.relationName !== input.candidate.relationName
      ) {
        continue;
      }
      // `through: Junction.relationField` pins the parent-side FK to the
      // junction relation field named, selecting one leg of a self-relation or
      // of multiple many-to-many between the same pair of models.
      if (through?.field !== undefined && parentFk.declaringFieldName !== through.field) {
        continue;
      }
      for (const childFk of junctionFks) {
        if (childFk === parentFk || childFk.targetModelName !== input.candidate.targetModelName) {
          continue;
        }
        // The model links both sides, so it is junction-shaped for this
        // candidate: record why it is declined rather than silently skipping.
        if (
          !idColumns ||
          !idColumnsAreExactlyFkPair(idColumns, parentFk.localColumns, childFk.localColumns)
        ) {
          nearMisses.push({ junctionModelName, reason: 'id-not-fk-covering' });
          continue;
        }
        const orderedChildColumns = childColumnsInTargetIdOrder(childFk, targetIdColumns);
        if (!orderedChildColumns) {
          nearMisses.push({ junctionModelName, reason: 'target-fk-not-id' });
          continue;
        }
        pairs.push({ parentFk, childFk, childColumnsInTargetIdOrder: orderedChildColumns });
      }
    }
  }
  return { pairs, nearMisses };
}

function junctionNearMissDiagnostic(
  candidate: ModelBackrelationCandidate,
  nearMiss: JunctionNearMiss,
  sourceId: string,
): ContractSourceDiagnostic {
  const listField = `${candidate.modelName}.${candidate.field.name}`;
  const data = {
    listField,
    junctionModel: nearMiss.junctionModelName,
    targetModel: candidate.targetModelName,
  };
  if (nearMiss.reason === 'through-field-not-fk') {
    return {
      code: 'PSL_JUNCTION_THROUGH_FIELD_NOT_FK',
      message: `Backrelation list field "${listField}" pins junction "${nearMiss.junctionModelName}" relation field "${nearMiss.throughField}" via through: ${nearMiss.junctionModelName}.${nearMiss.throughField}, but "${nearMiss.junctionModelName}" has no relation field "${nearMiss.throughField}" with a foreign key back to "${candidate.modelName}". Name a junction relation field whose foreign key references "${candidate.modelName}".`,
      sourceId,
      span: candidate.field.span,
      data: { ...data, throughField: nearMiss.throughField },
    };
  }
  if (nearMiss.reason === 'target-fk-not-id') {
    return {
      code: 'PSL_JUNCTION_TARGET_FK_NOT_ID',
      message: `Backrelation list field "${listField}" found junction model "${nearMiss.junctionModelName}", but its foreign key to "${candidate.targetModelName}" does not reference "${candidate.targetModelName}"'s @id. The junction's target-side foreign key must reference "${candidate.targetModelName}"'s full @id columns for many-to-many recognition.`,
      sourceId,
      span: candidate.field.span,
      data,
    };
  }
  return {
    code: 'PSL_JUNCTION_ID_NOT_FK_COVERING',
    message: `Backrelation list field "${listField}" found junction-shaped model "${nearMiss.junctionModelName}" linking "${candidate.modelName}" and "${candidate.targetModelName}", but its id does not cover exactly its foreign-key columns. Declare @@id([...]) on "${nearMiss.junctionModelName}" listing exactly the two foreign-key columns for many-to-many recognition.`,
    sourceId,
    span: candidate.field.span,
    data,
  };
}

function manyToManyRelationNode(
  candidate: ModelBackrelationCandidate,
  pair: JunctionFkPair,
): ModelRelationMetadata {
  return {
    fieldName: candidate.field.name,
    toModel: pair.childFk.targetModelName,
    toTable: pair.childFk.targetTableName,
    ...ifDefined('toNamespaceId', pair.childFk.targetNamespaceId),
    cardinality: 'N:M',
    on: {
      parentTable: candidate.tableName,
      parentColumns: pair.parentFk.referencedColumns,
      childTable: pair.parentFk.declaringTableName,
      childColumns: pair.parentFk.localColumns,
    },
    through: {
      table: pair.parentFk.declaringTableName,
      ...ifDefined('namespaceId', pair.parentFk.declaringNamespaceId),
      parentColumns: pair.parentFk.localColumns,
      childColumns: pair.childColumnsInTargetIdOrder,
    },
  };
}

function relationsForModel(
  modelRelations: Map<string, ModelRelationMetadata[]>,
  modelName: string,
): ModelRelationMetadata[] {
  const existing = modelRelations.get(modelName);
  if (existing) {
    return existing;
  }
  const created: ModelRelationMetadata[] = [];
  modelRelations.set(modelName, created);
  return created;
}

export function applyBackrelationCandidates(input: {
  readonly backrelationCandidates: readonly ModelBackrelationCandidate[];
  readonly fkRelationsByPair: Map<string, readonly FkRelationMetadata[]>;
  readonly fkRelationsByDeclaringModel: ReadonlyMap<string, readonly FkRelationMetadata[]>;
  readonly modelIdColumns: ReadonlyMap<string, readonly string[]>;
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
      const { pairs: junctionPairs, nearMisses } = findJunctionFkPairs({
        candidate,
        fkRelationsByDeclaringModel: input.fkRelationsByDeclaringModel,
        modelIdColumns: input.modelIdColumns,
      });
      const junctionPair = junctionPairs[0];
      if (junctionPairs.length === 1 && junctionPair) {
        relationsForModel(input.modelRelations, candidate.modelName).push(
          manyToManyRelationNode(candidate, junctionPair),
        );
        continue;
      }
      if (junctionPairs.length > 1) {
        input.diagnostics.push({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" matches multiple junction FK pairs for a many-to-many relation. Add @relation(name: "...") (or @relation("...")) to the list field and the junction FK-side relation pointing back at "${candidate.modelName}" to disambiguate.`,
          sourceId: input.sourceId,
          span: candidate.field.span,
        });
        continue;
      }
      const nearMiss = nearMisses[0];
      if (nearMiss) {
        input.diagnostics.push(junctionNearMissDiagnostic(candidate, nearMiss, input.sourceId));
        continue;
      }
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

    relationsForModel(input.modelRelations, candidate.modelName).push({
      fieldName: candidate.field.name,
      toModel: matched.declaringModelName,
      toTable: matched.declaringTableName,
      ...ifDefined('toNamespaceId', matched.declaringNamespaceId),
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
  readonly field: FieldSymbol;
  readonly sourceId: string;
  readonly composedExtensions: Set<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly familyId: string;
  readonly targetId: string;
}): boolean {
  let valid = true;
  for (const attribute of input.field.attributes) {
    if (attribute.name === 'relation') {
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
