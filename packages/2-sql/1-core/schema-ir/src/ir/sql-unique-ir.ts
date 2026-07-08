import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlUniqueIRInput {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
}

/**
 * Schema IR node for a table-level unique constraint as observed by
 * introspection.
 *
 * Implements `DiffableNode` so a unique constraint is directly a table's
 * diff-tree child. Unique constraints are frequently unnamed, so `id` is
 * derived from the column tuple rather than `name` — the column tuple is
 * also what makes two unique constraints the same constraint, so it doubles
 * as the pairing key. There are no further attributes to compare once
 * columns are equal (the differ pairs on `id`), so `isEqualTo` is identity.
 */
export class SqlUniqueIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.unique;

  readonly columns: readonly string[];
  declare readonly name?: string;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlUniqueIRInput) {
    super();
    this.columns = [...input.columns];
    if (input.name !== undefined) this.name = input.name;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }

  get id(): string {
    return `unique:${this.columns.join(',')}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlUniqueIR,
      'every diff-tree node the differ pairs at this position is a SqlUniqueIR; the id scheme keeps uniques from pairing with other node kinds'
    >(other);
    return this.id === node.id;
  }
}
