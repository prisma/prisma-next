import { type DdlColumn, DdlNode } from '@prisma-next/sql-relational-core/ast';

export interface SqliteDdlVisitor<R> {
  createTable(node: SqliteCreateTable): R;
}

export abstract class SqliteDdlNode extends DdlNode {
  abstract accept<R>(visitor: SqliteDdlVisitor<R>): R;
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze(columns.map((column) => Object.freeze({ ...column })));
}

export class SqliteCreateTable extends SqliteDdlNode {
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

  override accept<R>(visitor: SqliteDdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export type AnySqliteDdlNode = SqliteCreateTable;
