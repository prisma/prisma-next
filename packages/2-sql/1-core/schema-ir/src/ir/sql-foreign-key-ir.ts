import { freezeNode } from '@prisma-next/framework-components/ir';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export type SqlReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export interface SqlForeignKeyIRInput {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /**
   * Namespace coordinate of the referenced table. Required: the
   * introspector resolves and stamps it from the database's
   * `referenced_table_schema` (Postgres: `pg_namespace.nspname` of
   * `pg_class.relnamespace` on the confrelid table). For same-schema
   * FKs the introspector stamps the introspection scope itself, so the
   * coordinate is always present and consumers compare with strict
   * equality.
   */
  readonly referencedNamespaceId: string;
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
  readonly referencedNamespaceId: string;
  declare readonly name?: string;
  declare readonly onDelete?: SqlReferentialAction;
  declare readonly onUpdate?: SqlReferentialAction;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlForeignKeyIRInput) {
    super();
    if (input.referencedNamespaceId === undefined) {
      throw new Error(
        'SqlForeignKeyIR: `referencedNamespaceId` is required. Introspectors must stamp the resolved namespace coordinate (the introspection scope for same-schema FKs).',
      );
    }
    this.columns = input.columns;
    this.referencedTable = input.referencedTable;
    this.referencedColumns = input.referencedColumns;
    this.referencedNamespaceId = input.referencedNamespaceId;
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }
}
