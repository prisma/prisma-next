import type { DiffableNode, SchemaNodeRef } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { isArrayEqual } from '@prisma-next/utils/array-equal';
import { blindCast } from '@prisma-next/utils/casts';
import { InternalError } from '@prisma-next/utils/internal-error';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

/**
 * The default index access method (`btree` in every supported SQL target).
 * The constructor normalizes `type === DEFAULT_INDEX_TYPE` to absent, so an
 * authored `type: "btree"` and a default-method introspected index compare
 * equal — both derivation paths construct through this class. The contract
 * JSON and the wire-name content hash keep the authored spelling, so
 * `@@index([a], type: "btree")` and `@@index([a])` are distinct wire names
 * (a spelling change between them is a content edit — create + drop, not a
 * rename).
 */
const DEFAULT_INDEX_TYPE = 'btree';

/**
 * Every field is a required key. Values that may legitimately be absent
 * (an exact-named index's prefix, the btree→undefined type normalization)
 * are typed `| undefined` instead of optional, so each construction site
 * states the absence explicitly rather than omitting the key silently.
 * Undefined values still produce an instance without the property.
 */
export interface SqlIndexIRInput {
  /** Full physical name — the node's identity. */
  readonly name: string;
  /** Wire-name prefix. Present ⇔ managed; absent ⇔ exact-named. */
  readonly prefix: string | undefined;
  /** Column-tuple elements. Exactly one of `columns` / `expression` is set. */
  readonly columns: readonly string[] | undefined;
  /**
   * Opaque SQL: the entire element list between the parens of CREATE INDEX —
   * one string, never parsed.
   */
  readonly expression: string | undefined;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where: string | undefined;
  readonly unique: boolean;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  readonly annotations: SqlAnnotations | undefined;
  /**
   * The index's own column nodes, as root-anchored chains. The derivation
   * stamps them so an index is dropped before the columns it is built on
   * (Postgres auto-drops the index when a covered column goes). An expression
   * index stamps chains to every column of its table — a deterministic
   * over-approximation, since the opaque expression is never parsed. Never
   * compared by `isEqualTo`.
   */
  readonly dependsOn: readonly SchemaNodeRef[] | undefined;
  /**
   * Whether the index is partial (has a row predicate). Required: every
   * producer must assert partiality explicitly, because a partial unique
   * index does not guarantee at-most-one row per key and so cannot back a
   * 1:1 relation — "unknown" must not silently default to "total". Never
   * compared by `isEqualTo` and never serialized.
   */
  readonly partial: boolean;
}

/**
 * Schema IR node for a secondary index as observed by introspection.
 * Unlike the Contract IR `Index`, the Schema IR carries an explicit
 * `unique` field — introspection sees the underlying index regardless
 * of whether the user expressed it as `@@index` or `@@unique`, and the
 * verifier needs to distinguish them when comparing to the Contract.
 *
 * Implements `DiffableNode` so an index is directly a table's diff-tree
 * child. Indexes are name-identified: every index — contract-derived or
 * introspected — carries its full physical name, and `id` is that name.
 * Names are catalog-unique per schema, so two indexes legitimately sharing
 * one column tuple (a unique index beside a redundant plain index) are two
 * distinct siblings, and expression indexes need no column tuple at all.
 *
 * `isEqualTo` is selected by the receiver (the differ always calls
 * `expected.isEqualTo(actual)`): both modes compare `unique` strict, `type`
 * strict, `options` loosely, and `columns` ordered-strict when both sides
 * carry them; an exact-named receiver (`prefix === undefined`) additionally
 * byte-compares `expression`/`where` (both sides are reprints in the
 * supported flow — normalizing would only mask real drift); a managed
 * receiver never compares bodies (the wire-name hash already commits to
 * them).
 */
export class SqlIndexIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.index;

  readonly name: string;
  readonly unique: boolean;
  declare readonly prefix?: string;
  declare readonly columns?: readonly string[];
  declare readonly expression?: string;
  declare readonly where?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;
  declare readonly annotations?: SqlAnnotations;
  /** See {@link SqlIndexIRInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlColumnIR.codecRef`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];
  /** See {@link SqlIndexIRInput.partial}. Non-enumerable so it stays out of JSON and structural equality, matching `dependsOn`. */
  declare readonly partial: boolean;

  constructor(input: SqlIndexIRInput) {
    super();
    if ((input.columns === undefined) === (input.expression === undefined)) {
      throw new InternalError(
        `SqlIndexIR "${input.name}": exactly one of columns or expression must be set.`,
      );
    }
    this.name = input.name;
    this.unique = input.unique;
    if (input.prefix !== undefined) this.prefix = input.prefix;
    if (input.columns !== undefined) this.columns = input.columns;
    if (input.expression !== undefined) this.expression = input.expression;
    if (input.where !== undefined) this.where = input.where;
    if (input.type !== undefined && input.type !== DEFAULT_INDEX_TYPE) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    defineNonEnumerable(this, 'partial', input.partial);
    freezeNode(this);
  }

  get id(): string {
    return `index:${this.name}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static is(node: SqlSchemaIRNode): node is SqlIndexIR {
    return node.nodeKind === RelationalSchemaNodeKind.index;
  }

  /**
   * Mode-selected structural equality — see the class doc. `unique` and
   * `type` compare strictly (`type` after the btree→undefined normalization
   * the constructor applies to both sides — see {@link DEFAULT_INDEX_TYPE}),
   * `options` loosely
   * (introspection stringifies reloptions), `columns` ordered-strict when
   * both sides carry them. An exact receiver also byte-compares
   * `expression ?? ''` and `where ?? ''`; a managed receiver never does.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlIndexIR', SqlIndexIR.is);
    const structurallyEqual =
      this.unique === node.unique &&
      this.type === node.type &&
      indexOptionsLooselyEqual(this.options, node.options) &&
      (this.columns === undefined ||
        node.columns === undefined ||
        isArrayEqual(this.columns, node.columns));
    if (!structurallyEqual) return false;
    if (this.prefix !== undefined) return true;
    return (
      (this.expression ?? '') === (node.expression ?? '') &&
      (this.where ?? '') === (node.where ?? '')
    );
  }
}

/**
 * Option-bag equality ported from the relational walk: same key set, values
 * compared via `String()` coercion — Postgres introspection returns
 * reloptions values as raw strings (`'70'`, `'false'`) while contract option
 * leaves are typed (number, boolean, string). Exported for the planner's
 * rename content-pairing, which reuses this exact relation.
 */
export function indexOptionsLooselyEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  if (aKeys.length === 0) return true;
  for (const key of aKeys) {
    if (String(a?.[key]) !== String(b?.[key])) {
      return false;
    }
  }
  return true;
}
