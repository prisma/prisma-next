import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface ForeignKeyReferencesInput {
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * SQL Contract IR node for the referenced side of a foreign key. Lifted
 * from the pre-R3 flat-data `type ForeignKeyReferences` to a class
 * extending {@link SqlNode} per FR18.
 *
 * The cross-namespace shape (referenced-namespace coordinate on top of
 * `(table, columns)`) is M5b's load-bearing addition; the class is
 * shaped today around single-namespace references.
 */
export class ForeignKeyReferences extends SqlNode {
  readonly table: string;
  readonly columns: readonly string[];

  constructor(input: ForeignKeyReferencesInput) {
    super();
    this.table = input.table;
    this.columns = input.columns;
    freezeNode(this);
  }
}
