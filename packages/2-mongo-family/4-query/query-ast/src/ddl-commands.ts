import type { MongoIndexKey } from '@prisma-next/mongo-contract';
import { MongoAstNode } from './ast-node';
import type { MongoDdlCommandVisitor } from './ddl-visitors';

export interface CreateIndexOptions {
  readonly unique?: boolean | undefined;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly name?: string | undefined;
  readonly wildcardProjection?: Record<string, 0 | 1> | undefined;
  readonly collation?: Record<string, unknown> | undefined;
  readonly weights?: Record<string, number> | undefined;
  readonly default_language?: string | undefined;
  readonly language_override?: string | undefined;
}

export class CreateIndexCommand extends MongoAstNode {
  readonly kind = 'createIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly options: CreateIndexOptions | undefined;

  constructor(
    collection: string,
    keys: ReadonlyArray<MongoIndexKey>,
    options?: CreateIndexOptions,
  ) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.options = options;
    this.freeze();
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind, collection: this.collection, keys: this.keys, ...this.options };
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

export interface CreateCollectionOptions {
  readonly validator?: Record<string, unknown> | undefined;
  readonly validationLevel?: 'strict' | 'moderate' | undefined;
  readonly validationAction?: 'error' | 'warn' | undefined;
  readonly capped?: boolean | undefined;
  readonly size?: number | undefined;
  readonly max?: number | undefined;
  readonly timeseries?:
    | {
        timeField: string;
        metaField?: string;
        granularity?: 'seconds' | 'minutes' | 'hours';
      }
    | undefined;
  readonly collation?: Record<string, unknown> | undefined;
  readonly changeStreamPreAndPostImages?: { enabled: boolean } | undefined;
  readonly clusteredIndex?:
    | {
        key: Record<string, number>;
        unique: boolean;
        name?: string;
      }
    | undefined;
}

export class CreateCollectionCommand extends MongoAstNode {
  readonly kind = 'createCollection' as const;
  readonly collection: string;
  readonly options: CreateCollectionOptions | undefined;

  constructor(collection: string, options?: CreateCollectionOptions) {
    super();
    this.collection = collection;
    this.options = options;
    this.freeze();
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind, collection: this.collection, ...this.options };
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createCollection(this);
  }
}

export class DropCollectionCommand extends MongoAstNode {
  readonly kind = 'dropCollection' as const;
  readonly collection: string;

  constructor(collection: string) {
    super();
    this.collection = collection;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.dropCollection(this);
  }
}

export interface CollModOptions {
  readonly validator?: Record<string, unknown> | undefined;
  readonly validationLevel?: 'strict' | 'moderate' | undefined;
  readonly validationAction?: 'error' | 'warn' | undefined;
  readonly changeStreamPreAndPostImages?: { enabled: boolean } | undefined;
}

export class CollModCommand extends MongoAstNode {
  readonly kind = 'collMod' as const;
  readonly collection: string;
  readonly options: CollModOptions;

  constructor(collection: string, options: CollModOptions) {
    super();
    this.collection = collection;
    this.options = options;
    this.freeze();
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind, collection: this.collection, ...this.options };
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.collMod(this);
  }
}

export type AnyMongoDdlCommand =
  | CreateIndexCommand
  | DropIndexCommand
  | CreateCollectionCommand
  | DropCollectionCommand
  | CollModCommand;
