import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { isColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import type { AnyParamRef } from './types';

export interface DdlColumnDefaultVisitor<R> {
  literal(node: LiteralColumnDefault): R;
  function(node: FunctionColumnDefault): R;
}

export abstract class DdlColumnDefault {
  abstract readonly kind: string;
  abstract accept<R>(visitor: DdlColumnDefaultVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class LiteralColumnDefault extends DdlColumnDefault {
  readonly kind = 'literal' as const;
  readonly value: ColumnDefaultLiteralInputValue;

  constructor(value: ColumnDefaultLiteralInputValue) {
    super();
    if (!isColumnDefaultLiteralInputValue(value)) {
      throw new Error('Invalid column default literal value');
    }
    this.value = value;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>): R {
    return visitor.literal(this);
  }
}

export class FunctionColumnDefault extends DdlColumnDefault {
  readonly kind = 'function' as const;
  readonly expression: string;

  constructor(expression: string) {
    super();
    this.expression = expression;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>): R {
    return visitor.function(this);
  }
}

export type AnyDdlColumnDefault = LiteralColumnDefault | FunctionColumnDefault;

export class DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean | undefined;
  readonly primaryKey?: boolean | undefined;
  readonly default?: AnyDdlColumnDefault | undefined;

  constructor(options: {
    readonly name: string;
    readonly type: string;
    readonly notNull?: boolean;
    readonly primaryKey?: boolean;
    readonly default?: AnyDdlColumnDefault;
  }) {
    this.name = options.name;
    this.type = options.type;
    this.notNull = options.notNull;
    this.primaryKey = options.primaryKey;
    this.default = options.default;
    Object.freeze(this);
  }
}

export abstract class DdlNode {
  abstract readonly kind: string;

  /**
   * Structural brand: every DDL node answers `true`. Lets {@link isDdlNode}
   * recognise any `DdlNode` subclass — including target-contributed kinds —
   * without a central kind registry that subclasses would have to register
   * into.
   */
  isDdlNode(): true {
    return true;
  }

  protected freeze(): void {
    Object.freeze(this);
  }

  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}

export function isDdlNode(value: unknown): value is DdlNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isDdlNode' in value &&
    typeof value.isDdlNode === 'function'
  );
}

// ---------------------------------------------------------------------------
// Table-level constraint nodes
// ---------------------------------------------------------------------------

/**
 * A composite (or single-column) PRIMARY KEY constraint on a `CreateTable`
 * node. When `name` is set, the adapter renders `CONSTRAINT <name> PRIMARY KEY
 * (…)`; otherwise it renders an anonymous `PRIMARY KEY (…)`.
 *
 * Frozen on construction — immutable after creation.
 */
export class PrimaryKeyConstraint {
  readonly kind = 'primary-key' as const;
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;

  constructor(options: { readonly columns: readonly string[]; readonly name?: string }) {
    this.columns = Object.freeze([...options.columns]);
    this.name = options.name;
    Object.freeze(this);
  }
}

/**
 * A FOREIGN KEY constraint on a `CreateTable` node. `onDelete` and `onUpdate`
 * use the same `ReferentialAction` vocabulary already used by the migration
 * planner and the contract IR — no parallel string enum.
 *
 * Frozen on construction — immutable after creation.
 */
export class ForeignKeyConstraint {
  readonly kind = 'foreign-key' as const;
  readonly columns: ReadonlyArray<string>;
  readonly refTable: string;
  readonly refColumns: ReadonlyArray<string>;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
  readonly name: string | undefined;

  constructor(options: {
    readonly columns: readonly string[];
    readonly refTable: string;
    readonly refColumns: readonly string[];
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
    readonly name?: string;
  }) {
    this.columns = Object.freeze([...options.columns]);
    this.refTable = options.refTable;
    this.refColumns = Object.freeze([...options.refColumns]);
    this.onDelete = options.onDelete;
    this.onUpdate = options.onUpdate;
    this.name = options.name;
    Object.freeze(this);
  }
}

/**
 * A table-level UNIQUE constraint on a `CreateTable` node. When `name` is
 * set, the adapter renders `CONSTRAINT <name> UNIQUE (…)`; otherwise it
 * renders an anonymous `UNIQUE (…)`.
 *
 * Frozen on construction — immutable after creation.
 */
export class UniqueConstraint {
  readonly kind = 'unique' as const;
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;

  constructor(options: { readonly columns: readonly string[]; readonly name?: string }) {
    this.columns = Object.freeze([...options.columns]);
    this.name = options.name;
    Object.freeze(this);
  }
}

export type DdlTableConstraint = PrimaryKeyConstraint | ForeignKeyConstraint | UniqueConstraint;
