import type { PostgresSchema } from './postgres-schema';
import { quoteIdentifier } from './sql-utils';

export class PostgresEntityRef {
  readonly namespace: PostgresSchema;
  readonly name: string;
  readonly parent: PostgresEntityRef | undefined;

  constructor(options: {
    readonly namespace: PostgresSchema;
    readonly name: string;
    readonly parent?: PostgresEntityRef;
  }) {
    this.namespace = options.namespace;
    this.name = options.name;
    this.parent = options.parent;
    Object.freeze(this);
  }

  qualified(): string {
    return this.parent
      ? `${this.parent.qualified()}.${quoteIdentifier(this.name)}`
      : this.namespace.quoteTable(this.name);
  }
}
