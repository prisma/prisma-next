import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlCheckConstraintIRInput {
  /** Constraint name as stored in the database catalog. */
  readonly name: string;
  /** Column the check restricts. */
  readonly column: string;
  /** Permitted values the column must be IN. */
  readonly permittedValues: readonly string[];
}

/**
 * Schema IR node for a table-level check constraint that restricts a
 * column to a set of permitted values (an enum-style `IN (...)` check).
 *
 * Carries the **resolved values** rather than a raw SQL predicate so
 * callers can compare value-sets without parsing SQL.
 *
 * Implements `DiffableNode` so a check constraint is directly a table's
 * diff-tree child: `id` is the constraint name. `isEqualTo` compares
 * `column` and the permitted-value set (order-insensitive — the database
 * does not guarantee `IN (...)` ordering).
 */
export class SqlCheckConstraintIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.check;
  readonly name: string;
  readonly column: string;
  readonly permittedValues: readonly string[];

  constructor(input: SqlCheckConstraintIRInput) {
    super();
    this.name = input.name;
    this.column = input.column;
    this.permittedValues = Object.freeze([...input.permittedValues]);
    freezeNode(this);
  }

  get id(): string {
    return `check:${this.name}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlCheckConstraintIR,
      'every diff-tree node the differ pairs at this position is a SqlCheckConstraintIR; the id scheme keeps checks from pairing with other node kinds'
    >(other);
    if (this.column !== node.column) return false;
    if (this.permittedValues.length !== node.permittedValues.length) return false;
    const otherValues = new Set(node.permittedValues);
    return this.permittedValues.every((v) => otherValues.has(v));
  }
}
