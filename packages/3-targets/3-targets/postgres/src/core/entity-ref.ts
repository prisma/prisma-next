import type { PostgresSchema } from './postgres-schema';
import { quoteIdentifier } from './sql-utils';

export interface PostgresEntityRefVisitor<R> {
  tableRef(ref: PostgresTableRef): R;
  columnRef(ref: PostgresColumnRef): R;
}

export abstract class PostgresEntityRef {
  abstract accept<R>(visitor: PostgresEntityRefVisitor<R>): R;
  abstract qualified(): string;
}

export class PostgresTableRef extends PostgresEntityRef {
  readonly namespace: PostgresSchema;
  readonly name: string;

  constructor(options: { readonly namespace: PostgresSchema; readonly name: string }) {
    super();
    this.namespace = options.namespace;
    this.name = options.name;
    Object.freeze(this);
  }

  override qualified(): string {
    return this.namespace.quoteTable(this.name);
  }

  override accept<R>(visitor: PostgresEntityRefVisitor<R>): R {
    return visitor.tableRef(this);
  }
}

export class PostgresColumnRef extends PostgresEntityRef {
  readonly table: PostgresTableRef;
  readonly column: string;

  constructor(options: { readonly table: PostgresTableRef; readonly column: string }) {
    super();
    this.table = options.table;
    this.column = options.column;
    Object.freeze(this);
  }

  override qualified(): string {
    return `${this.table.qualified()}.${quoteIdentifier(this.column)}`;
  }

  override accept<R>(visitor: PostgresEntityRefVisitor<R>): R {
    return visitor.columnRef(this);
  }
}
