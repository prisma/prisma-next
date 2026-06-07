import { freezeNode } from '@prisma-next/framework-components/ir';
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
 */
export class SqlCheckConstraintIR extends SqlSchemaIRNode {
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
}
