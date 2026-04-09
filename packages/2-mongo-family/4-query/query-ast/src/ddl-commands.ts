import type { MongoIndexKey } from '@prisma-next/mongo-contract';
import { MongoAstNode } from './ast-node';
import type { MongoDdlCommandVisitor } from './ddl-visitors';

export interface CreateIndexOptions {
  readonly unique?: boolean | undefined;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly name?: string | undefined;
}

export class CreateIndexCommand extends MongoAstNode {
  readonly kind = 'createIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean | undefined;
  readonly sparse: boolean | undefined;
  readonly expireAfterSeconds: number | undefined;
  readonly partialFilterExpression: Record<string, unknown> | undefined;
  readonly name: string | undefined;

  constructor(
    collection: string,
    keys: ReadonlyArray<MongoIndexKey>,
    options?: CreateIndexOptions,
  ) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.unique = options?.unique;
    this.sparse = options?.sparse;
    this.expireAfterSeconds = options?.expireAfterSeconds;
    this.partialFilterExpression = options?.partialFilterExpression;
    this.name = options?.name;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

export class DropIndexCommand extends MongoAstNode {
  readonly kind = 'dropIndex' as const;
  readonly collection: string;
  readonly name: string;

  constructor(collection: string, name: string) {
    super();
    this.collection = collection;
    this.name = name;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}

export type AnyMongoDdlCommand = CreateIndexCommand | DropIndexCommand;
