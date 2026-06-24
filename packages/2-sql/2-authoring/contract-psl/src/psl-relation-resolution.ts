import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type {
  ArgType,
  FieldRefScope,
  FieldSymbol,
  InferAttr,
  InterpretCtx,
  ModelSymbol,
  PslDiagnostic,
  PslSpan,
  SymbolTable,
} from '@prisma-next/psl-parser';
import {
  fieldAttribute,
  fieldRef,
  identifier,
  interpretAttribute,
  list,
  nodePslSpan,
  oneOf,
  optional,
  str,
} from '@prisma-next/psl-parser';
import type { FieldAttributeAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import { ArrayLiteralAst } from '@prisma-next/psl-parser/syntax';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import type { RelationNode } from '@prisma-next/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@prisma-next/utils/assertions';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Result } from '@prisma-next/utils/result';
import { ok } from '@prisma-next/utils/result';

import {
  getAttribute,
  getNamedArgument,
  getPositionalArgument,
  parseFieldList,
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
};

type ModelRelationMetadata = RelationNode;

export function fkRelationPairKey(declaringModelName: string, targetModelName: string): string {
  // NOTE: We assume PSL model identifiers do not contain the `::` separator.
  return `${declaringModelName}::${targetModelName}`;
}

export function normalizeReferentialAction(actionToken: string): ReferentialAction | undefined {
  // the token is already validated by the `@relation` spec's `oneOf(identifier(...))`, so this is just a lookup — no second validation path here.
  return REFERENTIAL_ACTION_MAP[actionToken];
}

/**
 * Accepts a `@relation` directional argument value (`from:`/`to:`): a single
 * bare field (`from: userId`) or a bracketed list (`from: [a, b]`), normalised
 * to a field-name array. Delegating each shape to its own combinator keeps the
 * specific diagnostics (e.g. a nonexistent field) that `oneOf` would collapse
 * into a generic mismatch message.
 */
function fieldRefOrList(scope: FieldRefScope): ArgType<readonly string[]> {
  const single = fieldRef(scope);
  const bracketed = list(fieldRef(scope), { nonEmpty: true, unique: true });
  return {
    kind: 'fieldRefOrList',
    label: 'field name or field name[]',
    parse: (arg, ctx): Result<readonly string[], readonly PslDiagnostic[]> => {
      if (arg instanceof ArrayLiteralAst) {
        return bracketed.parse(arg, ctx);
      }
      const result = single.parse(arg, ctx);
      if (!result.ok) {
        return result;
      }
      return ok([result.value]);
    },
  };
}

function relationInvariants(
  parsed: {
    readonly from?: readonly string[];
    readonly to?: readonly string[];
    readonly fields?: readonly string[];
    readonly references?: readonly string[];
  },
  ctx: InterpretCtx,
): readonly PslDiagnostic[] {
  const hasFrom = parsed.from !== undefined || parsed.fields !== undefined;
  const hasTo = parsed.to !== undefined || parsed.references !== undefined;
  // `to:` may stand alone only alongside `from:` — a referenced key without
  // local FK fields is unresolvable, a cross-argument rule that per-argument
  // parsing can't enforce. `from:` alone is fine (references are inferred from
  // the target's `@id`).
  if (hasTo && !hasFrom) {
    return [
      {
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${ctx.selfModel.name}.${ctx.field?.name ?? ''}" requires a from argument naming the local foreign-key field(s)`,
        sourceId: ctx.sourceId,
        span: relationAttributeSpan(ctx),
      },
    ];
  }
  return [];
}

// `from:`/`to:` are the canonical local-fields/referenced-key arguments;
// legacy `fields:`/`references:` are accepted as input aliases that lower to
// the identical resolved relation. Canonical arguments accept a bare field or
// a bracketed list; the legacy spellings keep their bracketed-only contract.
const sqlRelation = fieldAttribute('relation', {
  positional: [{ key: 'name', type: optional(str()) }],
  named: {
    name: optional(str()),
    from: optional(fieldRefOrList('self')),
    to: optional(fieldRefOrList('referenced')),
    fields: optional(list(fieldRef('self'), { nonEmpty: true, unique: true })),
    references: optional(list(fieldRef('referenced'), { nonEmpty: true, unique: true })),
    map: optional(str()),
    onDelete: optional(
      oneOf(
        identifier('NoAction'),
        identifier('Restrict'),
        identifier('Cascade'),
        identifier('SetNull'),
        identifier('SetDefault'),
      ),
    ),
    onUpdate: optional(
      oneOf(
        identifier('NoAction'),
        identifier('Restrict'),
        identifier('Cascade'),
        identifier('SetNull'),
        identifier('SetDefault'),
      ),
    ),
  },
  refine: relationInvariants,
});

export type SqlRelationOutput = InferAttr<typeof sqlRelation>;

/**
 * The interpreted `@relation` attribute with the directional arguments
 * normalised: `from:` (or legacy `fields:`) lands in `fields`, `to:` (or
 * legacy `references:`) in `references`, so consumers see one shape whichever
 * spelling the schema used.
 */
export type ParsedSqlRelation = {
  readonly name?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  /**
   * Set when local FK fields are declared (`from:`/`fields:`) but the
   * referenced key is omitted (`to:`/`references:` absent). The caller resolves
   * the referenced columns from the target model's `@id`. `references` stays
   * undefined in this case; the two never co-occur.
   */
  readonly referencesInferred?: true;
  readonly map?: string;
  readonly onDelete?: SqlRelationOutput['onDelete'];
  readonly onUpdate?: SqlRelationOutput['onUpdate'];
};

function findRelationAttributeNode(field: FieldSymbol): FieldAttributeAst | undefined {
  for (const attribute of field.node.attributes()) {
    if (attribute.name()?.path().join('.') === 'relation') {
      return attribute;
    }
  }
  return undefined;
}

function relationAttributeSpan(ctx: InterpretCtx): PslSpan {
  const field = ctx.field;
  if (field !== undefined) {
    const node = findRelationAttributeNode(field);
    if (node !== undefined) {
      return nodePslSpan(node.syntax, ctx.sourceFile);
    }
    return field.span;
  }
  return ctx.selfModel.span;
}

function resolveReferencedModel(symbols: SymbolTable, field: FieldSymbol): ModelSymbol | undefined {
  const topLevel = symbols.topLevel.models[field.typeName];
  if (topLevel !== undefined) {
    return topLevel;
  }
  for (const namespace of Object.values(symbols.topLevel.namespaces)) {
    const model = namespace.models[field.typeName];
    if (model !== undefined) {
      return model;
    }
  }
  return undefined;
}

function buildRelationInterpretCtx(input: {
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly symbols: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}): InterpretCtx {
  return {
    level: 'field',
    sourceId: input.sourceId,
    sourceFile: input.sourceFile,
    selfModel: input.selfModel,
    field: input.field,
    resolveReferencedModel: () => resolveReferencedModel(input.symbols, input.field),
  };
}

export function interpretRelationAttribute(input: {
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly symbols: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ParsedSqlRelation | undefined {
  const attributeNode = findRelationAttributeNode(input.field);
  if (attributeNode === undefined) {
    return undefined;
  }
  const ctx = buildRelationInterpretCtx(input);
  const result = interpretAttribute(attributeNode, sqlRelation, ctx);
  if (!result.ok) {
    for (const failure of result.failure) {
      input.diagnostics.push(failure);
    }
    return undefined;
  }
  const value = result.value;
  const fields = value.from ?? value.fields;
  const references = value.to ?? value.references;
  const referencesInferred: true | undefined =
    fields !== undefined && references === undefined ? true : undefined;
  return {
    ...ifDefined('name', value.name),
    ...ifDefined('fields', fields),
    ...ifDefined('references', references),
    ...ifDefined('referencesInferred', referencesInferred),
    ...ifDefined('map', value.map),
    ...ifDefined('onDelete', value.onDelete),
    ...ifDefined('onUpdate', value.onUpdate),
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
type JunctionNearMiss = {
  readonly junctionModelName: string;
  readonly reason: 'id-not-fk-covering' | 'target-fk-not-id';
};

/**
 * Finds explicit junction models that connect a bare backrelation list field
 * to its target model: a model whose composite id columns are exactly the FK
 * columns of one relation back to the candidate's model (the parent side) and
 * one relation to the candidate's target model (the child side). The child
 * FK must reference exactly the target model's id columns; its junction
 * columns are carried in target-id order on the pair. A relation name on the
 * list field pins the parent-side FK relation, which is how self-referential
 * many-to-many sides are disambiguated.
 *
 * Alongside the recognised pairs, returns junction-shaped near-misses (models
 * that link both sides but were declined) so the caller can emit a
 * junction-specific diagnostic instead of the generic orphaned-list message.
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
  const pairs: JunctionFkPair[] = [];
  const nearMisses: JunctionNearMiss[] = [];
  for (const [junctionModelName, junctionFks] of input.fkRelationsByDeclaringModel) {
    const idColumns = input.modelIdColumns.get(junctionModelName);
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
