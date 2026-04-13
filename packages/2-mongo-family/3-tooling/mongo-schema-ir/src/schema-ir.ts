import type { MongoSchemaCollection } from './schema-collection';
import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export class MongoSchemaIR extends MongoSchemaNode {
  readonly kind = 'schema' as const;
  readonly collections: ReadonlyArray<MongoSchemaCollection>;
  readonly collectionNames: ReadonlyArray<string>;

  private readonly _byName: Map<string, MongoSchemaCollection>;

  constructor(collections: ReadonlyArray<MongoSchemaCollection>) {
    super();
    const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    this.collections = sorted;
    this._byName = new Map(sorted.map((c) => [c.name, c]));
    this.collectionNames = sorted.map((c) => c.name);
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.schema(this);
  }

  collection(name: string): MongoSchemaCollection | undefined {
    return this._byName.get(name);
  }
}
