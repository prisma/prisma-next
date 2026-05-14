import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface UniqueConstraintInput {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * SQL Contract IR node for a table-level unique constraint. Lifted from
 * the pre-R3 flat-data `type UniqueConstraint` to a class extending
 * {@link SqlNode} per FR18.
 */
export class UniqueConstraint extends SqlNode {
  readonly columns: readonly string[];
  declare readonly name?: string;

  constructor(input: UniqueConstraintInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    freezeNode(this);
  }
}
