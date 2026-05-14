import { freezeNode } from '@prisma-next/framework-components/ir';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlIndexIRInput {
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  readonly annotations?: SqlAnnotations;
}

/**
 * Schema IR node for a secondary index as observed by introspection.
 * Unlike the Contract IR `Index`, the Schema IR carries an explicit
 * `unique` field — introspection sees the underlying index regardless
 * of whether the user expressed it as `@@index` or `@@unique`, and the
 * verifier needs to distinguish them when comparing to the Contract.
 */
export class SqlIndexIR extends SqlSchemaIRNode {
  readonly columns: readonly string[];
  readonly unique: boolean;
  declare readonly name?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlIndexIRInput) {
    super();
    this.columns = input.columns;
    this.unique = input.unique;
    if (input.name !== undefined) this.name = input.name;
    if (input.type !== undefined) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }
}
