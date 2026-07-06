import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export interface PrimaryKeyInput {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * Primary-key Schema IR node. Mirrors the Contract IR `PrimaryKey`
 * shape (same `columns` + optional `name`) so verification can compare
 * intent and actual structurally. Defined here independently to avoid
 * a sql-schema-ir -> sql-contract dependency.
 *
 * Implements `DiffableNode` so a primary key is directly a table's diff-tree
 * child. `id` is a fixed sentinel — a table has at most one primary key, so
 * there is never a sibling to disambiguate against. `isEqualTo` compares the
 * column tuple; the PK's own `name` is a database-assigned label with no
 * semantic weight, so it is not compared (mirrors the policy node's
 * name-insensitivity to non-identifying detail).
 */
export class PrimaryKey extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.primaryKey;
  readonly columns: readonly string[];
  declare readonly name?: string;

  constructor(input: PrimaryKeyInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    freezeNode(this);
  }

  get id(): string {
    return 'primary-key';
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      PrimaryKey,
      'every diff-tree node the differ pairs at this position is a PrimaryKey; the fixed sentinel id keeps it from pairing with other node kinds'
    >(other);
    return (
      this.columns.length === node.columns.length &&
      this.columns.every((c, i) => c === node.columns[i])
    );
  }
}
