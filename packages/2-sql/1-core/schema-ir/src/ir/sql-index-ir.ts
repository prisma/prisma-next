import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { assertNode, SqlSchemaIRNode } from './sql-schema-ir-node';

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
 * doubles as the pairing key. `isEqualTo` is symmetric structural equality
 * on the remaining attributes: `unique`, `type`, and `options`. A unique
 * index and a non-unique index on the same columns are different objects
 * and are not equal — there is no "stronger satisfies weaker".
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

  static is(node: SqlSchemaIRNode): node is SqlIndexIR {
    return node.nodeKind === RelationalSchemaNodeKind.index;
  }

  /**
   * Symmetric structural equality: two paired index nodes are equal iff their
   * `unique` flag, `type`, and (loosely-compared) `options` all match. There
   * is no satisfaction — a unique index does not equal a non-unique index.
   * `options` compares loosely (introspection stringifies reloptions); `type`
   * compares strictly after the introspection-side btree→undefined
   * normalization done at construction.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlIndexIR', SqlIndexIR.is);
    return (
      this.unique === node.unique &&
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
