import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';

export type SqlReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export interface SqlForeignKeyIRInput {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /** Schema (namespace) of the referenced table — populated by adapters that introspect cross-schema FKs. */
  readonly referencedSchema?: string;
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
 *
 * Implements `DiffableNode` so a foreign key is directly a table's diff-tree
 * child. Foreign keys are frequently unnamed (introspection may not carry a
 * constraint name, and the contract side never invents one), so `id` is
 * derived from the referencing/referenced coordinates rather than `name` —
 * the same tuple that makes two FK constraints the same constraint. This
 * also serves as the comparison key: two FKs with the same coordinates are
 * paired by the differ, and `isEqualTo` then compares the remaining
 * attribute — the referential actions.
 */
export class SqlForeignKeyIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.foreignKey;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  declare readonly referencedSchema?: string;
  declare readonly name?: string;
  declare readonly onDelete?: SqlReferentialAction;
  declare readonly onUpdate?: SqlReferentialAction;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlForeignKeyIRInput) {
    super();
    this.columns = input.columns;
    this.referencedTable = input.referencedTable;
    this.referencedColumns = input.referencedColumns;
    if (input.referencedSchema !== undefined) this.referencedSchema = input.referencedSchema;
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }

  get id(): string {
    const referencedSchema = this.referencedSchema ?? '';
    return `foreign-key:${this.columns.join(',')}->${referencedSchema}.${this.referencedTable}(${this.referencedColumns.join(',')})`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlForeignKeyIR,
      'every diff-tree node the differ pairs at this position is a SqlForeignKeyIR; the id scheme keeps foreign keys from pairing with other node kinds'
    >(other);
    return this.onDelete === node.onDelete && this.onUpdate === node.onUpdate;
  }
}
