import { freezeNode } from '@prisma-next/framework-components/ir';
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
 */
export class SqlUniqueIR extends SqlSchemaIRNode {
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
}
