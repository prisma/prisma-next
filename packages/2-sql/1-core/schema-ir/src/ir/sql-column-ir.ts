import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { resolvedDefaultsEqual } from './resolved-default-equality';
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
  /**
   * Fully resolved native type, comparable across the two diff sides:
   * the contract-derived side stamps the codec-expanded type (typeRef
   * resolved, parameterized types expanded, `[]` appended for arrays);
   * the introspected side stamps the target-normalized type with the same
   * `[]` convention. Stamped at construction by derivation/introspection;
   * absent on raw hand-built nodes.
   */
  readonly resolvedNativeType?: string;
  /**
   * Structured default, comparable across the two diff sides: the
   * contract-derived side stamps the contract's `ColumnDefault`; the
   * introspected side stamps the target default-normalizer's parse of the
   * raw expression. Absent when the column declares no default, or when
   * the introspected raw default could not be parsed.
   */
  readonly resolvedDefault?: ColumnDefault;
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
 * compares this column's own attributes only — never children, since a
 * column is a leaf. When both sides carry `resolvedNativeType` (stamped at
 * derivation/introspection), the comparison uses the resolved values —
 * resolved native type, nullability, and structured default equality per
 * the relational walk's `columnDefaultsEqual` semantics, with `this` as the
 * expected side. Otherwise it falls back to comparing raw fields.
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
  declare readonly resolvedNativeType?: string;
  declare readonly resolvedDefault?: ColumnDefault;

  constructor(input: SqlColumnIRInput) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType;
    this.nullable = input.nullable;
    if (input.default !== undefined) this.default = input.default;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.many !== undefined) this.many = input.many;
    if (input.resolvedNativeType !== undefined) this.resolvedNativeType = input.resolvedNativeType;
    if (input.resolvedDefault !== undefined) this.resolvedDefault = input.resolvedDefault;
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
    if (this.resolvedNativeType !== undefined && node.resolvedNativeType !== undefined) {
      return (
        this.resolvedNativeType === node.resolvedNativeType &&
        this.nullable === node.nullable &&
        this.resolvedDefaultEqualTo(node)
      );
    }
    return (
      this.nativeType === node.nativeType &&
      this.nullable === node.nullable &&
      this.default === node.default &&
      Boolean(this.many) === Boolean(node.many)
    );
  }

  /**
   * Resolved-mode default equality with `this` as the expected side: an
   * expected column with no declared default requires the actual to carry
   * none (raw or resolved); a declared expected default requires a parseable
   * actual default that matches structurally.
   */
  private resolvedDefaultEqualTo(node: SqlColumnIR): boolean {
    if (this.resolvedDefault === undefined) {
      return node.resolvedDefault === undefined && node.default === undefined;
    }
    if (node.resolvedDefault === undefined) {
      return false;
    }
    return resolvedDefaultsEqual(
      this.resolvedDefault,
      node.resolvedDefault,
      node.resolvedNativeType ?? this.resolvedNativeType,
    );
  }
}
