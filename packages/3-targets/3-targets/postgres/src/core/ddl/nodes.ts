import {
  type DdlColumn,
  DdlNode,
  type DdlTableConstraint,
} from '@prisma-next/sql-relational-core/ast';
import type { RlsPolicyOperation } from '../rls/canonicalize';

// ---------------------------------------------------------------------------
// AlterTableAction — nested polymorphic hierarchy
// ---------------------------------------------------------------------------

export interface AlterTableActionVisitor<R> {
  addColumn(action: AddColumnAction): R;
  dropDefault(action: DropDefaultAction): R;
}

export abstract class AlterTableAction {
  abstract readonly kind: string;
  abstract accept<R>(visitor: AlterTableActionVisitor<R>): R;
}

export class AddColumnAction extends AlterTableAction {
  readonly kind = 'add-column' as const;
  readonly column: DdlColumn;

  constructor(column: DdlColumn) {
    super();
    this.column = column;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.addColumn(this);
  }
}

export class DropDefaultAction extends AlterTableAction {
  readonly kind = 'drop-default' as const;
  readonly columnName: string;

  constructor(columnName: string) {
    super();
    this.columnName = columnName;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.dropDefault(this);
  }
}

/**
 * The set of ALTER TABLE subactions currently expressible as typed DDL.
 *
 * The remaining actions — SetDefault, SetNotNull, DropNotNull,
 * AlterColumnType — are still emitted as raw SQL by `operations/columns.ts`
 * and join this union as they are converted to typed DDL. Until then it is
 * intentionally partial: only the ALTER subactions used by the
 * already-converted ops (AddColumn, DropDefault) appear here.
 */
export type AnyAlterTableAction = AddColumnAction | DropDefaultAction;

// ---------------------------------------------------------------------------
// Top-level DDL visitor
// ---------------------------------------------------------------------------

export interface PostgresDdlVisitor<R> {
  createTable(node: PostgresCreateTable): R;
  createSchema(node: PostgresCreateSchema): R;
  alterTable(node: PostgresAlterTable): R;
  createPolicy(node: PostgresCreatePolicy): R;
  dropPolicy(node: PostgresDropPolicy): R;
}

export abstract class PostgresDdlNode extends DdlNode {
  abstract accept<R>(visitor: PostgresDdlVisitor<R>): R;
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze([...columns]);
}

function freezeConstraints(
  constraints: readonly DdlTableConstraint[] | undefined,
): ReadonlyArray<DdlTableConstraint> | undefined {
  return constraints ? Object.freeze([...constraints]) : undefined;
}

export class PostgresCreateTable extends PostgresDdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly ifNotExists: boolean | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;
  readonly constraints: ReadonlyArray<DdlTableConstraint> | undefined;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.columns = freezeDdlColumns(options.columns);
    this.constraints = freezeConstraints(options.constraints);
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export class PostgresCreateSchema extends PostgresDdlNode {
  readonly kind = 'create-schema' as const;
  readonly schema: string;
  readonly ifNotExists: boolean | undefined;

  constructor(options: { readonly schema: string; readonly ifNotExists?: boolean }) {
    super();
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createSchema(this);
  }
}

export class PostgresAlterTable extends PostgresDdlNode {
  readonly kind = 'alter-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly actions: ReadonlyArray<AnyAlterTableAction>;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly actions: readonly AnyAlterTableAction[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.actions = Object.freeze([...options.actions]);
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.alterTable(this);
  }
}

export type { RlsPolicyOperation };

export class PostgresCreatePolicy extends PostgresDdlNode {
  readonly kind = 'create-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly permissive: boolean;
  readonly operation: RlsPolicyOperation;
  readonly roles: ReadonlyArray<string>;
  readonly using: string | undefined;
  readonly withCheck: string | undefined;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly permissive: boolean;
    readonly operation: RlsPolicyOperation;
    readonly roles: readonly string[];
    readonly using?: string;
    readonly withCheck?: string;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.permissive = options.permissive;
    this.operation = options.operation;
    this.roles = Object.freeze([...options.roles]);
    this.using = options.using;
    this.withCheck = options.withCheck;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createPolicy(this);
  }
}

export class PostgresDropPolicy extends PostgresDdlNode {
  readonly kind = 'drop-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;

  constructor(options: { readonly schema: string; readonly table: string; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.dropPolicy(this);
  }
}

export type AnyPostgresDdlNode =
  | PostgresCreateTable
  | PostgresCreateSchema
  | PostgresAlterTable
  | PostgresCreatePolicy
  | PostgresDropPolicy;
