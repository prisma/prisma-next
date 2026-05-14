import { freezeNode } from '@prisma-next/framework-components/ir';
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
 */
export class PrimaryKey extends SqlSchemaIRNode {
  readonly columns: readonly string[];
  declare readonly name?: string;

  constructor(input: PrimaryKeyInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    freezeNode(this);
  }
}
