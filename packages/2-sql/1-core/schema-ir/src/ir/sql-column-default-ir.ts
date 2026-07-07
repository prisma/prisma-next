import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { resolvedDefaultsEqual } from './resolved-default-equality';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { type SqlSchemaDiffRole, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlColumnDefaultIRInput {
  /** Structured resolved default (contract-declared or normalizer-parsed). */
  readonly resolved?: ColumnDefault;
  /** Raw database default expression, when known (introspected side). */
  readonly raw?: string;
  /**
   * Native-type context for temporal literal normalization — the owning
   * column's resolved native type.
   */
  readonly nativeTypeContext?: string;
}

/**
 * Schema-diff node for a column's default value. The default is the one
 * column attribute with an extra/missing/drift lifecycle of its own, so it
 * is a child node of the column rather than a compared attribute: an
 * undeclared live default surfaces as `not-expected`, a declared default the
 * database lacks as `not-found`, and a divergent value as `not-equal` — the
 * three reasons cover the legacy `extra_default` / `default_missing` /
 * `default_mismatch` vocabulary with no attribute inspection.
 *
 * `id` is a fixed sentinel — a column has at most one default. Built
 * transiently by `SqlColumnIR.children()` from the column's own fields;
 * never constructed by derivation or introspection directly.
 */
export class SqlColumnDefaultIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.columnDefault;

  override get diffRole(): SqlSchemaDiffRole {
    return 'auxiliary';
  }
  declare readonly resolved?: ColumnDefault;
  declare readonly raw?: string;
  declare readonly nativeTypeContext?: string;

  constructor(input: SqlColumnDefaultIRInput) {
    super();
    if (input.resolved !== undefined) this.resolved = input.resolved;
    if (input.raw !== undefined) this.raw = input.raw;
    if (input.nativeTypeContext !== undefined) this.nativeTypeContext = input.nativeTypeContext;
    freezeNode(this);
  }

  get id(): string {
    return 'default';
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  /**
   * Structured comparison with `this` as the expected side: both sides
   * resolved compare per the relational walk's `columnDefaultsEqual`
   * semantics; a declared expected default against an unparseable actual
   * (raw present, no resolved parse) is a mismatch; two raw-only nodes fall
   * back to raw string equality.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlColumnDefaultIR,
      'the fixed sentinel id under a column pairs a default node only with the other side column default node'
    >(other);
    if (this.resolved !== undefined && node.resolved !== undefined) {
      return resolvedDefaultsEqual(
        this.resolved,
        node.resolved,
        node.nativeTypeContext ?? this.nativeTypeContext,
      );
    }
    if (this.resolved !== undefined || node.resolved !== undefined) {
      return false;
    }
    return this.raw === node.raw;
  }
}
