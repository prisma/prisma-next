import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface IndexInput {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

/**
 * SQL Contract IR node for a table-level secondary index. Lifted from
 * the pre-R3 flat-data `type Index` to a class extending {@link SqlNode}
 * per FR18.
 *
 * Note that this class shadows the global TypeScript `Index` lib type at
 * the family-shared name; consumer files that need both should alias one
 * (e.g. `import { Index as SqlIndexNode } from '@prisma-next/sql-contract/types'`).
 */
export class Index extends SqlNode {
  readonly columns: readonly string[];
  declare readonly name?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;

  constructor(input: IndexInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    if (input.type !== undefined) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    freezeNode(this);
  }
}
