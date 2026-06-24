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

/**
 * The four named segments of an arrow-path `through:`, declaring a many-to-many
 * over a junction that carries scalar columns + `@@id` but no relation fields:
 * `through: "<localKey> -> <Junction.nearCol> -> <Junction.farCol> -> <targetKey>"`.
 * Each junction segment is `Model.column`; the local/target keys are bare field
 * names on the declaring/target models. The two junction segments name the same
 * junction model (its near + far foreign-key columns), and recognition builds
 * the `through` descriptor straight from these columns — the relation-field-based
 * junction recognition cannot fire when the junction declares no relation fields.
 */
export type ArrowPath = {
  readonly localKey: string;
  readonly nearJunctionModel: string;
  readonly nearColumn: string;
  readonly farJunctionModel: string;
  readonly farColumn: string;
  readonly targetModel: string;
  readonly targetKey: string;
};

export type ParsedRelationAttribute = {
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  /**
   * Set when local FK fields are declared (`from:`) but the referenced key is
   * omitted (`to:` absent). The caller resolves the referenced columns from the
   * target model's `@id`. `references` stays undefined in this case; the two
   * never co-occur.
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
  /**
   * The arrow-path named by a quoted `through:` value carrying `->`. Declares a
   * many-to-many over a junction with scalar columns + `@@id` but no relation
   * fields; the `through` descriptor is built from the path-named columns
   * directly. Mutually exclusive with `through` — a `through:` value is either a
   * junction name/pin or an arrow path, never both.
   */
  readonly arrowPath?: ArrowPath;
  /**
   * The FK-side relation field named by `inverse:` on a one-to-many back-relation
   * list field (`posts Post[] @relation(inverse: editor)` ⇒ `inverse: 'editor'`).
   * A bare relation-field name pinning the owning foreign-key field, used to
   * disambiguate when multiple relations link the same pair of models.
   */
  readonly inverse?: string;
  readonly constraintName?: string;
  readonly onDelete?: string;
  readonly onUpdate?: string;
};

/**
 * Parses a single `@relation` directional argument value (`from:`/`to:`). A
 * single field may be bare (`from: userId`) or bracketed (`from: [userId]`);
 * composites must be bracketed (`from: [a, b]`).
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

/** The arrow-path uses a quoted-string `through:` value carrying the `->` separator. */
function isArrowPathValue(raw: string): boolean {
  return unquoteStringLiteral(raw).includes('->');
}

/**
 * Parses a four-segment arrow-path `through:` value
 * (`"localKey -> Junction.nearCol -> Junction.farCol -> Target.targetKey"`) into
 * its named parts. The middle two segments are `Model.column`; the first and
 * last are bare keys (a leading `Model.` qualifier on them is tolerated and
 * dropped, like `from:`/`to:`). Returns undefined on the wrong segment count or
 * a malformed junction segment, which the caller turns into a diagnostic.
 */
function parseArrowPath(raw: string): ArrowPath | undefined {
  const segments = unquoteStringLiteral(raw)
    .split('->')
    .map((segment) => segment.trim());
  if (segments.length !== 4 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }
  const [localSegment, nearSegment, farSegment, targetSegment] = segments;
  if (
    localSegment === undefined ||
    nearSegment === undefined ||
    farSegment === undefined ||
    targetSegment === undefined
  ) {
    return undefined;
  }
  const near = splitQualifiedColumn(nearSegment);
  const far = splitQualifiedColumn(farSegment);
  const target = splitQualifiedColumn(targetSegment);
  if (!near || !far || !target) {
    return undefined;
  }
  return {
    localKey: stripModelQualifier(localSegment),
    nearJunctionModel: near.model,
    nearColumn: near.column,
    farJunctionModel: far.model,
    farColumn: far.column,
    targetModel: target.model,
    targetKey: target.column,
  };
}

/** Splits a `Model.column` arrow segment; returns undefined unless both parts are present. */
function splitQualifiedColumn(segment: string): { model: string; column: string } | undefined {
  const dotIndex = segment.indexOf('.');
  if (dotIndex === -1) {
    return undefined;
  }
  const model = segment.slice(0, dotIndex).trim();
  const column = segment.slice(dotIndex + 1).trim();
  if (model.length === 0 || column.length === 0 || column.includes('.')) {
    return undefined;
  }
  return { model, column };
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
  readonly localColumns: readonly string[];
  readonly referencedColumns: readonly string[];
};

export type ModelBackrelationCandidate = {
  readonly modelName: string;
  readonly tableName: string;
  readonly field: FieldSymbol;
  readonly targetModelName: string;
  /**
   * The junction named by `through:` on the list field. When present,
   * many-to-many recognition considers only `junction` rather than scanning
   * every junction-shaped model linking the two sides; an optional `field` pins
   * the parent-side junction FK by its relation field, disambiguating
   * self-relations and multiple many-to-many between the same pair of models.
   */
  readonly through?: ParsedThrough;
  /**
   * The arrow-path named by a quoted `through:` value carrying `->`. When
   * present, many-to-many recognition builds the `through` descriptor straight
   * from the path-named columns rather than scanning relation-field-based
   * junction foreign keys, which the junction (declaring no relation fields)
   * does not carry.
   */
  readonly arrowPath?: ArrowPath;
  /**
   * The FK-side relation field named by `inverse:` on a one-to-many back-relation
   * list field. When present, FK-side matching pins the back-relation to the FK
   * relation whose declaring field is `inverse`, disambiguating multiple
   * relations linking the same pair of models.
   */
  readonly inverse?: string;
};

type ModelRelationMetadata = RelationNode;

export function fkRelationPairKey(declaringModelName: string, targetModelName: string): string {
  // NOTE: We assume PSL model identifiers do not contain the `::` separator.
  return `${declaringModelName}::${targetModelName}`;
}

/** Total order on model names for the alphabetical `_<A>To<B>` synthesis. */
function compareModelNames(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
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

function legacyRelationNameDiagnostic(
  input: { readonly modelName: string; readonly fieldName: string; readonly sourceId: string },
  span: PslSpan,
): ContractSourceDiagnostic {
  return {
    code: 'PSL_LEGACY_RELATION_NAME',
    message: `Relation field "${input.modelName}.${input.fieldName}" uses @relation(name:) (or a positional @relation("...")), which is no longer supported — disambiguate with inverse: (1:N back-relation) or through: Junction.field (M:N)`,
    sourceId: input.sourceId,
    span,
  };
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

  const positionalNameEntry = getPositionalArgumentEntry(input.attribute);
  if (positionalNameEntry) {
    input.diagnostics.push(legacyRelationNameDiagnostic(input, positionalNameEntry.span));
    return undefined;
  }

  for (const arg of input.attribute.args) {
    if (arg.kind === 'positional') {
      continue;
    }
    if (arg.name === 'fields' || arg.name === 'references') {
      input.diagnostics.push({
        code: 'PSL_LEGACY_FIELDS_REFERENCES',
        message: `Relation field "${input.modelName}.${input.fieldName}" uses @relation(fields:/references:), which is no longer supported — use from:/to: instead`,
        sourceId: input.sourceId,
        span: arg.span,
      });
      return undefined;
    }
    if (arg.name === 'name') {
      input.diagnostics.push(legacyRelationNameDiagnostic(input, arg.span));
      return undefined;
    }
    if (
      arg.name !== 'from' &&
      arg.name !== 'to' &&
      arg.name !== 'through' &&
      arg.name !== 'inverse' &&
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

  // `from:`/`to:` are the only local-fields/referenced-key arguments.
  const fromRaw = getNamedArgument(input.attribute, 'from');
  const toRaw = getNamedArgument(input.attribute, 'to');
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

  // `through:` names the junction for a navigable many-to-many list field. A
  // quoted value carrying `->` is the arrow-path form, declaring the M:N over a
  // junction with no relation fields by naming its columns directly. Otherwise
  // the junction is the head of a bare value: `through: PostTag` names the
  // junction alone, `through: PostTag.post` additionally pins the parent-side
  // junction FK by its relation field.
  const throughRaw = getNamedArgument(input.attribute, 'through');
  let through: ParsedThrough | undefined;
  let arrowPath: ArrowPath | undefined;
  if (throughRaw !== undefined && isArrowPathValue(throughRaw)) {
    arrowPath = parseArrowPath(throughRaw);
    if (!arrowPath) {
      input.diagnostics.push({
        code: 'PSL_ARROW_PATH_MALFORMED',
        message: `Relation field "${input.modelName}.${input.fieldName}" has a malformed arrow-path through:; expected "localKey -> Junction.nearColumn -> Junction.farColumn -> Target.targetKey".`,
        sourceId: input.sourceId,
        span: input.attribute.span,
      });
      return undefined;
    }
  } else {
    through = throughRaw ? parseThroughArgument(throughRaw) : undefined;
  }

  // `inverse:` names the owning FK-side relation field for a one-to-many
  // back-relation: a bare relation-field name (no member-access grammar). It
  // pins the back-relation to one of several relations linking the same pair of
  // models, the directional replacement for a name-based disambiguator.
  const inverseRaw = getNamedArgument(input.attribute, 'inverse');
  const inverse = inverseRaw ? inverseRaw.trim() : undefined;

  const onDeleteArgument = getNamedArgument(input.attribute, 'onDelete');
  const onUpdateArgument = getNamedArgument(input.attribute, 'onUpdate');

  return {
    ...ifDefined('fields', fields),
    ...ifDefined('references', references),
    ...ifDefined('referencesInferred', referencesInferred),
    ...ifDefined('through', through),
    ...ifDefined('arrowPath', arrowPath),
    ...ifDefined('inverse', inverse !== undefined && inverse.length > 0 ? inverse : undefined),
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

/**
 * Builds the N:M relation node for one navigable end declared with an arrow
 * path. The columns are resolved straight from the path's named segments rather
 * than from junction foreign keys: `parentColumns`/`on.parentColumns` walk the
 * declaring model's local key, the junction's near column carries the parent
 * leg of the join, and the far column carries the child leg to the target.
 * `targetColumns` is filled downstream by the contract assembler from the
 * target model's id.
 */
function arrowPathManyToManyRelationNode(input: {
  readonly candidate: ModelBackrelationCandidate;
  readonly targetTableName: string;
  readonly targetNamespaceId?: string;
  readonly junctionTableName: string;
  readonly junctionNamespaceId?: string;
  readonly localColumns: readonly string[];
  readonly nearColumn: string;
  readonly farColumn: string;
}): ModelRelationMetadata {
  return {
    fieldName: input.candidate.field.name,
    toModel: input.candidate.targetModelName,
    toTable: input.targetTableName,
    ...ifDefined('toNamespaceId', input.targetNamespaceId),
    cardinality: 'N:M',
    on: {
      parentTable: input.candidate.tableName,
      parentColumns: input.localColumns,
      childTable: input.junctionTableName,
      childColumns: [input.nearColumn],
    },
    through: {
      table: input.junctionTableName,
      ...ifDefined('namespaceId', input.junctionNamespaceId),
      parentColumns: [input.nearColumn],
      childColumns: [input.farColumn],
    },
  };
}

function oneToManyRelationNode(
  candidate: ModelBackrelationCandidate,
  matched: FkRelationMetadata,
): ModelRelationMetadata {
  return {
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

/**
 * One side of a synthesised implicit-many-to-many junction: the navigable list
 * field, the model that declares it, and the model it points at. Two of these
 * (or one, for a self-referential list) compose into a `SynthesizedJunction`.
 */
type ImplicitManyToManyEnd = {
  readonly candidate: ModelBackrelationCandidate;
};

/**
 * An implicit many-to-many junction the interpreter must synthesise: a
 * model-less junction table linking two models neither of which declares a
 * foreign key, and no authored junction model links them. The names follow
 * Prisma's `_<A>To<B>` convention — `modelA`/`modelB` are the two terminal model
 * names ordered alphabetically, `A`/`B` are the junction's two foreign-key
 * columns (A references `modelA`'s id, B references `modelB`'s id). `ends`
 * carries the one or two navigable list fields that resolve to this junction;
 * a self-referential list contributes a single end.
 */
export type SynthesizedJunction = {
  readonly junctionModelName: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly ends: readonly ImplicitManyToManyEnd[];
};

/** The junction column referencing each terminal model's id. */
export const SYNTHESIZED_JUNCTION_COLUMN_A = 'A';
export const SYNTHESIZED_JUNCTION_COLUMN_B = 'B';

/** Prisma's implicit-many-to-many junction name: `_<ModelA>To<ModelB>`. */
export function synthesizedJunctionName(modelA: string, modelB: string): string {
  return `_${modelA}To${modelB}`;
}

/**
 * Builds the N:M relation node for one navigable end of a synthesised junction.
 * `selfColumn` is the junction foreign-key column referencing the declaring
 * model (A or B); `otherColumn` references the target model. `targetColumns` is
 * filled downstream by the contract assembler from the target model's id.
 */
function synthesizedManyToManyRelationNode(input: {
  readonly candidate: ModelBackrelationCandidate;
  readonly targetTableName: string;
  readonly targetNamespaceId?: string;
  readonly junctionTableName: string;
  readonly junctionNamespaceId?: string;
  readonly localColumns: readonly string[];
  readonly selfColumn: string;
  readonly otherColumn: string;
}): ModelRelationMetadata {
  return {
    fieldName: input.candidate.field.name,
    toModel: input.candidate.targetModelName,
    toTable: input.targetTableName,
    ...ifDefined('toNamespaceId', input.targetNamespaceId),
    cardinality: 'N:M',
    on: {
      parentTable: input.candidate.tableName,
      parentColumns: input.localColumns,
      childTable: input.junctionTableName,
      childColumns: [input.selfColumn],
    },
    through: {
      table: input.junctionTableName,
      ...ifDefined('namespaceId', input.junctionNamespaceId),
      parentColumns: [input.selfColumn],
      childColumns: [input.otherColumn],
    },
  };
}

/**
 * Resolves an arrow-path `through:` to its N:M relation node by validating the
 * path against the declared models' columns and building the `through`
 * descriptor straight from the named columns. The relation-field-based junction
 * recognition cannot fire here — the junction declares no relation fields — so
 * this path reads the junction's near/far foreign-key columns by name.
 *
 * Validates: the two junction segments name the same declared model; that model
 * carries both named columns as two distinct columns; the declaring model
 * carries the local key; the target model is the candidate's target and carries
 * the target key. Each failure pushes an actionable diagnostic and returns
 * undefined so the candidate is skipped rather than mis-lowered.
 */
function resolveArrowPathManyToMany(input: {
  readonly candidate: ModelBackrelationCandidate;
  readonly arrowPath: ArrowPath;
  readonly modelFieldColumns: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly modelTableNames: ReadonlyMap<string, string>;
  readonly modelNamespaceIds: ReadonlyMap<string, string>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): ModelRelationMetadata | undefined {
  const { candidate, arrowPath } = input;
  const listField = `${candidate.modelName}.${candidate.field.name}`;
  const span = candidate.field.span;

  // The two junction segments must name one and the same junction model — a
  // junction is a single table, so near and far columns live on it together.
  if (arrowPath.nearJunctionModel !== arrowPath.farJunctionModel) {
    input.diagnostics.push({
      code: 'PSL_ARROW_PATH_JUNCTION_MISMATCH',
      message: `Arrow-path through: on "${listField}" names two different junction models "${arrowPath.nearJunctionModel}" and "${arrowPath.farJunctionModel}". Both junction columns must live on the same junction model.`,
      sourceId: input.sourceId,
      span,
      data: {
        listField,
        nearJunctionModel: arrowPath.nearJunctionModel,
        farJunctionModel: arrowPath.farJunctionModel,
      },
    });
    return undefined;
  }
  const junctionModel = arrowPath.nearJunctionModel;

  const junctionColumns = input.modelFieldColumns.get(junctionModel);
  if (!junctionColumns) {
    input.diagnostics.push({
      code: 'PSL_ARROW_PATH_JUNCTION_NOT_MODEL',
      message: `Arrow-path through: on "${listField}" names junction "${junctionModel}", which is not a declared model. Declare a junction model with the near and far columns and an @@id over them.`,
      sourceId: input.sourceId,
      span,
      data: { listField, junctionModel },
    });
    return undefined;
  }

  // The target segment must name the candidate's target model; the contract's
  // navigable list field already fixes the target by its element type.
  if (arrowPath.targetModel !== candidate.targetModelName) {
    input.diagnostics.push({
      code: 'PSL_ARROW_PATH_TARGET_MISMATCH',
      message: `Arrow-path through: on "${listField}" names target model "${arrowPath.targetModel}", but the list field's type is "${candidate.targetModelName}". The arrow-path target must match the list field's element type.`,
      sourceId: input.sourceId,
      span,
      data: {
        listField,
        arrowTarget: arrowPath.targetModel,
        fieldTarget: candidate.targetModelName,
      },
    });
    return undefined;
  }

  const localColumn = resolveArrowColumn({
    model: candidate.modelName,
    field: arrowPath.localKey,
    columns: input.modelFieldColumns.get(candidate.modelName),
    listField,
    span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
  });
  const nearColumn = resolveArrowColumn({
    model: junctionModel,
    field: arrowPath.nearColumn,
    columns: junctionColumns,
    listField,
    span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
  });
  const farColumn = resolveArrowColumn({
    model: junctionModel,
    field: arrowPath.farColumn,
    columns: junctionColumns,
    listField,
    span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
  });
  const targetColumn = resolveArrowColumn({
    model: candidate.targetModelName,
    field: arrowPath.targetKey,
    columns: input.modelFieldColumns.get(candidate.targetModelName),
    listField,
    span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
  });
  if (
    localColumn === undefined ||
    nearColumn === undefined ||
    farColumn === undefined ||
    targetColumn === undefined
  ) {
    return undefined;
  }

  // The near and far columns must be two distinct junction columns: a junction
  // joins two sides, and a single shared column cannot carry both legs.
  if (nearColumn === farColumn) {
    input.diagnostics.push({
      code: 'PSL_ARROW_PATH_JUNCTION_MISMATCH',
      message: `Arrow-path through: on "${listField}" uses the same junction column "${nearColumn}" for both the near and far side. The two junction columns must be distinct.`,
      sourceId: input.sourceId,
      span,
      data: { listField, junctionModel, column: nearColumn },
    });
    return undefined;
  }

  return arrowPathManyToManyRelationNode({
    candidate,
    targetTableName:
      input.modelTableNames.get(candidate.targetModelName) ?? candidate.targetModelName,
    ...ifDefined('targetNamespaceId', input.modelNamespaceIds.get(candidate.targetModelName)),
    junctionTableName: input.modelTableNames.get(junctionModel) ?? junctionModel,
    ...ifDefined('junctionNamespaceId', input.modelNamespaceIds.get(junctionModel)),
    localColumns: [localColumn],
    nearColumn,
    farColumn,
  });
}

/** Resolves one arrow-path field name to its storage column, diagnosing an unknown column. */
function resolveArrowColumn(input: {
  readonly model: string;
  readonly field: string;
  readonly columns: ReadonlyMap<string, string> | undefined;
  readonly listField: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): string | undefined {
  const column = input.columns?.get(input.field);
  if (column === undefined) {
    input.diagnostics.push({
      code: 'PSL_ARROW_PATH_COLUMN_NOT_FOUND',
      message: `Arrow-path through: on "${input.listField}" names "${input.model}.${input.field}", but "${input.model}" has no such field.`,
      sourceId: input.sourceId,
      span: input.span,
      data: { listField: input.listField, model: input.model, field: input.field },
    });
    return undefined;
  }
  return column;
}

export function applyBackrelationCandidates(input: {
  readonly backrelationCandidates: readonly ModelBackrelationCandidate[];
  readonly fkRelationsByPair: Map<string, readonly FkRelationMetadata[]>;
  readonly fkRelationsByDeclaringModel: ReadonlyMap<string, readonly FkRelationMetadata[]>;
  readonly modelIdColumns: ReadonlyMap<string, readonly string[]>;
  readonly modelFieldColumns: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly modelTableNames: ReadonlyMap<string, string>;
  readonly modelNamespaceIds: ReadonlyMap<string, string>;
  readonly declaredTableNames: ReadonlySet<string>;
  readonly modelRelations: Map<string, ModelRelationMetadata[]>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): { readonly synthesizedJunctions: readonly SynthesizedJunction[] } {
  // Bare-list candidates that found no FK-side match, no authored junction, and
  // no junction near-miss: implicit-many-to-many candidates resolved after the
  // main loop, where a mirror end (or a self-referential list) turns the pair
  // into a synthesised junction and a lone end stays orphaned.
  const orphanedEnds: ModelBackrelationCandidate[] = [];

  for (const candidate of input.backrelationCandidates) {
    // An arrow-path `through:` declares the many-to-many over a junction with no
    // relation fields by naming its columns directly, so it resolves from the
    // path columns rather than the relation-field-based junction recognition.
    if (candidate.arrowPath !== undefined) {
      const arrowRelation = resolveArrowPathManyToMany({
        candidate,
        arrowPath: candidate.arrowPath,
        modelFieldColumns: input.modelFieldColumns,
        modelTableNames: input.modelTableNames,
        modelNamespaceIds: input.modelNamespaceIds,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
      });
      if (arrowRelation) {
        relationsForModel(input.modelRelations, candidate.modelName).push(arrowRelation);
      }
      continue;
    }

    const pairKey = fkRelationPairKey(candidate.targetModelName, candidate.modelName);
    const pairMatches = input.fkRelationsByPair.get(pairKey) ?? [];

    // `inverse:` pins a one-to-many back-relation to the FK-side relation whose
    // declaring field it names, the directional disambiguator across multiple
    // relations between the same pair of models. A relation field name is unique
    // within its model, so at most one FK-side relation matches. When `inverse:`
    // names a field that is not an FK-side relation back to the candidate, report
    // it rather than letting recognition fall into the generic ambiguity or
    // junction path.
    if (candidate.inverse !== undefined) {
      const inverseMatched = pairMatches.find(
        (relation) => relation.declaringFieldName === candidate.inverse,
      );
      if (!inverseMatched) {
        input.diagnostics.push({
          code: 'PSL_INVERSE_FIELD_NOT_FK',
          message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" pins FK-side relation field "${candidate.inverse}" via inverse: ${candidate.inverse}, but "${candidate.targetModelName}" has no relation field "${candidate.inverse}" with a foreign key back to "${candidate.modelName}". Name an FK-side relation field whose foreign key references "${candidate.modelName}".`,
          sourceId: input.sourceId,
          span: candidate.field.span,
          data: {
            listField: `${candidate.modelName}.${candidate.field.name}`,
            targetModel: candidate.targetModelName,
            inverseField: candidate.inverse,
          },
        });
        continue;
      }
      relationsForModel(input.modelRelations, candidate.modelName).push(
        oneToManyRelationNode(candidate, inverseMatched),
      );
      continue;
    }

    const matches = [...pairMatches];

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
          message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" matches multiple junction FK pairs for a many-to-many relation. Add through: Junction.relationField (the qualified junction pin) to the list field to disambiguate.`,
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
      // No FK-side match, no authored junction, no near-miss: a bare navigable
      // list with nothing to bind to. Deferred — a mirror bare list (or a
      // self-referential list) makes this an implicit many-to-many to
      // synthesise; a lone end stays orphaned.
      orphanedEnds.push(candidate);
      continue;
    }
    if (matches.length > 1) {
      input.diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
        message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" matches multiple FK-side relations on model "${candidate.targetModelName}". Add inverse: <fkField> to the list field, naming the FK-side relation field it pairs with, to disambiguate.`,
        sourceId: input.sourceId,
        span: candidate.field.span,
      });
      continue;
    }

    invariant(matches.length === 1, 'Backrelation matching requires exactly one match');
    const matched = matches[0];
    assertDefined(matched, 'Backrelation matching requires a defined relation match');

    relationsForModel(input.modelRelations, candidate.modelName).push(
      oneToManyRelationNode(candidate, matched),
    );
  }

  return resolveImplicitManyToMany({
    orphanedEnds,
    modelIdColumns: input.modelIdColumns,
    modelTableNames: input.modelTableNames,
    modelNamespaceIds: input.modelNamespaceIds,
    declaredTableNames: input.declaredTableNames,
    modelRelations: input.modelRelations,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
  });
}

/**
 * Pairs up the bare navigable list fields that found nothing to bind to and
 * turns each pair (or self-referential list) into a synthesised implicit
 * many-to-many junction, emitting the N:M relations on both ends. A lone end
 * with no mirror stays orphaned; a pair whose terminal lacks an `@id`, a pair
 * with more than one implicit many-to-many between the same models, and a
 * synthesised name that collides with a real table are each diagnosed.
 */
function resolveImplicitManyToMany(input: {
  readonly orphanedEnds: readonly ModelBackrelationCandidate[];
  readonly modelIdColumns: ReadonlyMap<string, readonly string[]>;
  readonly modelTableNames: ReadonlyMap<string, string>;
  readonly modelNamespaceIds: ReadonlyMap<string, string>;
  readonly declaredTableNames: ReadonlySet<string>;
  readonly modelRelations: Map<string, ModelRelationMetadata[]>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): { readonly synthesizedJunctions: readonly SynthesizedJunction[] } {
  // Group the ends by the unordered pair of models they link. A self-relation
  // pairs a single end with itself; a two-sided relation pairs the two ends.
  const endsByPair = new Map<string, ModelBackrelationCandidate[]>();
  for (const candidate of input.orphanedEnds) {
    const [first, second] = [candidate.modelName, candidate.targetModelName].sort(
      compareModelNames,
    );
    const pairKey = `${first}::${second}`;
    const ends = endsByPair.get(pairKey);
    if (ends) {
      ends.push(candidate);
    } else {
      endsByPair.set(pairKey, [candidate]);
    }
  }

  const synthesizedJunctions: SynthesizedJunction[] = [];
  for (const ends of endsByPair.values()) {
    const first = ends[0];
    if (!first) {
      continue;
    }
    const isSelfRelation = first.modelName === first.targetModelName;

    // A lone end with no mirror is genuinely orphaned: there is no second
    // navigable side to make a many-to-many. A self-referential list is its own
    // mirror and synthesises from a single end.
    if (!isSelfRelation && ends.length < 2) {
      input.diagnostics.push(orphanedBackrelationDiagnostic(first, input.sourceId));
      continue;
    }
    // More than one implicit many-to-many between the same pair of models: the
    // synthesised `_<A>To<B>` name would collide, and there is no junction model
    // to disambiguate. A self-relation tolerates a single end (its own mirror);
    // anything beyond the expected end count is ambiguous.
    const expectedEndCount = isSelfRelation ? 1 : 2;
    if (ends.length > expectedEndCount) {
      for (const end of ends) {
        input.diagnostics.push({
          code: 'PSL_IMPLICIT_MN_AMBIGUOUS',
          message: `Backrelation list field "${end.modelName}.${end.field.name}" is one of multiple implicit many-to-many relations between "${end.modelName}" and "${end.targetModelName}". Name an explicit junction model (or use through:) so each relation has a distinct junction.`,
          sourceId: input.sourceId,
          span: end.field.span,
        });
      }
      continue;
    }

    const [modelA, modelB] = [first.modelName, first.targetModelName].sort(compareModelNames);
    if (modelA === undefined || modelB === undefined) {
      continue;
    }
    const junctionModelName = synthesizedJunctionName(modelA, modelB);

    // A model named like the synthesised junction already declares a table:
    // synthesising would clobber it. Report rather than overwrite.
    if (input.declaredTableNames.has(junctionModelName)) {
      input.diagnostics.push({
        code: 'PSL_IMPLICIT_MN_NAME_COLLISION',
        message: `Implicit many-to-many between "${modelA}" and "${modelB}" would synthesise a junction table "${junctionModelName}", but a table with that name already exists. Rename the conflicting model or declare an explicit junction model.`,
        sourceId: input.sourceId,
        span: first.field.span,
      });
      continue;
    }

    // Both terminal models must expose a single-column `@id` to reference: each
    // synthesised foreign key (A, B) is a single column pointing at it. A
    // composite or absent id has no single column to reference here (sibling
    // slice 7 territory), so it is diagnosed rather than synthesised.
    const idA = input.modelIdColumns.get(modelA);
    const idB = input.modelIdColumns.get(modelB);
    const offendingIdModel =
      idA === undefined || idA.length !== 1
        ? modelA
        : idB === undefined || idB.length !== 1
          ? modelB
          : undefined;
    if (offendingIdModel !== undefined || idA === undefined || idB === undefined) {
      const offending = offendingIdModel ?? modelA;
      input.diagnostics.push({
        code: 'PSL_IMPLICIT_MN_TARGET_NO_ID',
        message: `Implicit many-to-many between "${modelA}" and "${modelB}" cannot synthesise a junction: model "${offending}" must declare a single-column @id to reference. Add a single-column @id to "${offending}", or model the junction explicitly.`,
        sourceId: input.sourceId,
        span: first.field.span,
      });
      continue;
    }

    const synthesizedEnds: ImplicitManyToManyEnd[] = [];
    for (const end of ends) {
      const localColumns = input.modelIdColumns.get(end.modelName);
      assertDefined(localColumns, 'implicit many-to-many end must reference an @id-bearing model');
      // The junction foreign-key column referencing the declaring model: A when
      // the declaring model is the alphabetically-first, B otherwise.
      const selfColumn =
        end.modelName === modelA ? SYNTHESIZED_JUNCTION_COLUMN_A : SYNTHESIZED_JUNCTION_COLUMN_B;
      const otherColumn =
        selfColumn === SYNTHESIZED_JUNCTION_COLUMN_A
          ? SYNTHESIZED_JUNCTION_COLUMN_B
          : SYNTHESIZED_JUNCTION_COLUMN_A;
      relationsForModel(input.modelRelations, end.modelName).push(
        synthesizedManyToManyRelationNode({
          candidate: end,
          targetTableName: input.modelTableNames.get(end.targetModelName) ?? end.targetModelName,
          ...ifDefined('targetNamespaceId', input.modelNamespaceIds.get(end.targetModelName)),
          junctionTableName: junctionModelName,
          ...ifDefined('junctionNamespaceId', input.modelNamespaceIds.get(modelA)),
          localColumns,
          selfColumn,
          otherColumn,
        }),
      );
      synthesizedEnds.push({ candidate: end });
    }

    synthesizedJunctions.push({
      junctionModelName,
      modelA,
      modelB,
      ends: synthesizedEnds,
    });
  }

  return { synthesizedJunctions };
}

function orphanedBackrelationDiagnostic(
  candidate: ModelBackrelationCandidate,
  sourceId: string,
): ContractSourceDiagnostic {
  return {
    code: 'PSL_ORPHANED_BACKRELATION_LIST',
    message: `Backrelation list field "${candidate.modelName}.${candidate.field.name}" has no matching FK-side relation on model "${candidate.targetModelName}". Add @relation(from: [...], to: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
    sourceId,
    span: candidate.field.span,
  };
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
