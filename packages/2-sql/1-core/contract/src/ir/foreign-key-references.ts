import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface ForeignKeyReferencesInput {
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * SQL Contract IR node for the referenced side of a foreign key.
 *
 * The class is shaped around single-namespace references today; a
 * future milestone introduces a cross-namespace coordinate on top of
 * `(table, columns)` when namespace-keyed storage lands.
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
