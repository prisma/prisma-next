import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

/**
 * Namespaced annotations for extensibility. Each namespace
 * (e.g. `pg`, `pgvector`) owns its annotations subtree.
 */
export type SqlAnnotations = {
  readonly [namespace: string]: unknown;
};

export interface SqlColumnIRInput {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  /** Raw database default expression (e.g. `'hello'::text`, `nextval('seq')`). */
  readonly default?: string;
  readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `nativeType` carries the element type only (e.g. `text`, `int4`). */
  readonly many?: boolean;
}

/**
 * Schema IR node for a single column on a table, as observed by
 * introspection. Unlike the Contract IR `StorageColumn`, this carries
 * the column's `name` (Schema IR columns are returned as arrays from
 * introspection queries; the parent table re-keys them into a record
 * for downstream consumers).
 *
 * Implements `DiffableNode` so a column is directly a table's diff-tree
 * child: `id` is the column name (unique among a table's columns); `isEqualTo`
 * compares this column's own attributes only (native type, nullability,
 * default, array-ness) — never children, since a column is a leaf.
 */
export class SqlColumnIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.column;
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  declare readonly default?: string;
  declare readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `nativeType` carries the element type only (e.g. `text`, `int4`). */
  declare readonly many?: boolean;

  constructor(input: SqlColumnIRInput) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType;
    this.nullable = input.nullable;
    if (input.default !== undefined) this.default = input.default;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.many !== undefined) this.many = input.many;
    freezeNode(this);
  }

  get id(): string {
    return `column:${this.name}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlColumnIR,
      'every diff-tree node the differ pairs at this position is a SqlColumnIR; the id scheme keeps columns from pairing with other node kinds'
    >(other);
    return (
      this.nativeType === node.nativeType &&
      this.nullable === node.nullable &&
      this.default === node.default &&
      Boolean(this.many) === Boolean(node.many)
    );
  }
}
