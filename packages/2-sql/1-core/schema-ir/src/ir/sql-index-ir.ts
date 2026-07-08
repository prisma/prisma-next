import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlIndexIRInput {
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  readonly annotations?: SqlAnnotations;
}

/**
 * Schema IR node for a secondary index as observed by introspection.
 * Unlike the Contract IR `Index`, the Schema IR carries an explicit
 * `unique` field — introspection sees the underlying index regardless
 * of whether the user expressed it as `@@index` or `@@unique`, and the
 * verifier needs to distinguish them when comparing to the Contract.
 *
 * Implements `DiffableNode` so an index is directly a table's diff-tree
 * child. Indexes are frequently unnamed, so `id` is derived from the column
 * tuple — the same tuple that makes two indexes the same index, so it
 * doubles as the pairing key. `isEqualTo` compares the remaining attributes:
 * `unique`, `type`, and `options`.
 */
export class SqlIndexIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.index;

  readonly columns: readonly string[];
  readonly unique: boolean;
  declare readonly name?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlIndexIRInput) {
    super();
    this.columns = input.columns;
    this.unique = input.unique;
    if (input.name !== undefined) this.name = input.name;
    if (input.type !== undefined) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }

  get id(): string {
    return `index:${this.columns.join(',')}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  /**
   * Comparison with `this` as the expected side, matching the relational
   * walk's index satisfaction: a unique actual index satisfies a non-unique
   * expected index (stronger satisfies weaker), while an expected unique
   * index requires a unique actual. Type and options compare as attributes.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlIndexIR,
      'every diff-tree node the differ pairs at this position is a SqlIndexIR; the id scheme keeps indexes from pairing with other node kinds'
    >(other);
    return (
      (!this.unique || node.unique) &&
      this.type === node.type &&
      indexOptionsLooselyEqual(this.options, node.options)
    );
  }
}

/**
 * Option-bag equality ported from the relational walk: same key set, values
 * compared via `String()` coercion — Postgres introspection returns
 * reloptions values as raw strings (`'70'`, `'false'`) while contract option
 * leaves are typed (number, boolean, string).
 */
function indexOptionsLooselyEqual(
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
