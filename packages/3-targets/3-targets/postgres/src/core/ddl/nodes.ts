import { type DdlColumn, DdlNode } from '@prisma-next/sql-relational-core/ast';

export interface PostgresDdlVisitor<R> {
  createTable(node: PostgresCreateTable): R;
  createSchema(node: PostgresCreateSchema): R;
}

export abstract class PostgresDdlNode extends DdlNode {
  abstract accept<R>(visitor: PostgresDdlVisitor<R>): R;
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze([...columns]);
}

export class PostgresCreateTable extends PostgresDdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly ifNotExists: boolean | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.columns = freezeDdlColumns(options.columns);
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

export type AnyPostgresDdlNode = PostgresCreateTable | PostgresCreateSchema;
