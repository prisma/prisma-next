import type { PostgresSchema } from './postgres-schema';
import { quoteIdentifier } from './sql-utils';

export class PostgresEntityRef {
  readonly namespace: PostgresSchema;
  readonly id: string;
  readonly parent: PostgresEntityRef | undefined;

  constructor(options: {
    readonly namespace: PostgresSchema;
    readonly id: string;
    readonly parent?: PostgresEntityRef;
  }) {
    this.namespace = options.namespace;
    this.id = options.id;
    this.parent = options.parent;
    Object.freeze(this);
  }

  qualified(): string {
    return this.parent
      ? `${this.parent.qualified()}.${quoteIdentifier(this.id)}`
      : this.namespace.quoteTable(this.id);
  }
}
