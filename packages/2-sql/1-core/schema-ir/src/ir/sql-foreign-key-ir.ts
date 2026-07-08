import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { type SqlSchemaDiffRole, SqlSchemaIRNode } from './sql-schema-ir-node';

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
  /**
   * The real live DDL namespace of the referenced table, comparable across
   * the two diff sides. Contract-derived trees stamp it explicitly (resolving
   * namespace ids — including the unbound sentinel — to the DDL namespace);
   * introspected FKs default it to `referencedSchema`, whose value already
   * is the live namespace. Folded into `id` in place of the raw value so an
   * unbound-namespace contract FK pairs with its introspected counterpart.
   */
  readonly resolvedReferencedNamespace?: string;
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

  override get diffRole(): SqlSchemaDiffRole {
    return 'auxiliary';
  }
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  declare readonly referencedSchema?: string;
  declare readonly name?: string;
  declare readonly onDelete?: SqlReferentialAction;
  declare readonly onUpdate?: SqlReferentialAction;
  declare readonly annotations?: SqlAnnotations;
  declare readonly resolvedReferencedNamespace?: string;

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
    const resolvedReferencedNamespace = input.resolvedReferencedNamespace ?? input.referencedSchema;
    if (resolvedReferencedNamespace !== undefined) {
      this.resolvedReferencedNamespace = resolvedReferencedNamespace;
    }
    freezeNode(this);
  }

  get id(): string {
    const referencedNamespace = this.resolvedReferencedNamespace ?? '';
    return `foreign-key:${this.columns.join(',')}->${referencedNamespace}.${this.referencedTable}(${this.referencedColumns.join(',')})`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  /**
   * Referential-action comparison with `this` as the expected side, matching
   * the relational walk's `getReferentialActionMismatches`: `noAction` is the
   * database default and equivalent to an undeclared action, and drift is
   * flagged only when the expected side declares a (normalized) action.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlForeignKeyIR,
      'every diff-tree node the differ pairs at this position is a SqlForeignKeyIR; the id scheme keeps foreign keys from pairing with other node kinds'
    >(other);
    return (
      referentialActionMatches(this.onDelete, node.onDelete) &&
      referentialActionMatches(this.onUpdate, node.onUpdate)
    );
  }
}

function referentialActionMatches(
  expected: SqlReferentialAction | undefined,
  actual: SqlReferentialAction | undefined,
): boolean {
  const normalizedExpected = expected === 'noAction' ? undefined : expected;
  if (normalizedExpected === undefined) return true;
  const normalizedActual = actual === 'noAction' ? undefined : actual;
  return normalizedExpected === normalizedActual;
}
