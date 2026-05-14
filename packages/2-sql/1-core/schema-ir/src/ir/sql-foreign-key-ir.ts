import { freezeNode } from '@prisma-next/framework-components/ir';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export type SqlReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export interface SqlForeignKeyIRInput {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly onDelete?: SqlReferentialAction;
  readonly onUpdate?: SqlReferentialAction;
  readonly annotations?: SqlAnnotations;
}

/**
 * Schema IR node for a foreign-key constraint as observed by
 * introspection. The `referencedTable` / `referencedColumns` field
 * names match the introspection vocabulary (`pg_constraint.confkey`,
 * etc.) and intentionally differ from the Contract IR's nested
 * `references: { table, columns }` shape so that the verifier's
 * structural comparison stays explicit about which side it's reading.
 */
export class SqlForeignKeyIR extends SqlSchemaIRNode {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  declare readonly name?: string;
  declare readonly onDelete?: SqlReferentialAction;
  declare readonly onUpdate?: SqlReferentialAction;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlForeignKeyIRInput) {
    super();
    this.columns = input.columns;
    this.referencedTable = input.referencedTable;
    this.referencedColumns = input.referencedColumns;
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }
}
