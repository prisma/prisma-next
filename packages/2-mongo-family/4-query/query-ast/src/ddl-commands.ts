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
  readonly unique: boolean | undefined;
  readonly sparse: boolean | undefined;
  readonly expireAfterSeconds: number | undefined;
  readonly partialFilterExpression: Record<string, unknown> | undefined;
  readonly name: string | undefined;
  readonly wildcardProjection: Record<string, 0 | 1> | undefined;
  readonly collation: Record<string, unknown> | undefined;
  readonly weights: Record<string, number> | undefined;
  readonly default_language: string | undefined;
  readonly language_override: string | undefined;

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
    this.wildcardProjection = options?.wildcardProjection;
    this.collation = options?.collation;
    this.weights = options?.weights;
    this.default_language = options?.default_language;
    this.language_override = options?.language_override;
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
  readonly validator: Record<string, unknown> | undefined;
  readonly validationLevel: 'strict' | 'moderate' | undefined;
  readonly validationAction: 'error' | 'warn' | undefined;
  readonly capped: boolean | undefined;
  readonly size: number | undefined;
  readonly max: number | undefined;
  readonly timeseries:
    | {
        timeField: string;
        metaField?: string;
        granularity?: 'seconds' | 'minutes' | 'hours';
      }
    | undefined;
  readonly collation: Record<string, unknown> | undefined;
  readonly changeStreamPreAndPostImages: { enabled: boolean } | undefined;
  readonly clusteredIndex:
    | {
        key: Record<string, number>;
        unique: boolean;
        name?: string;
      }
    | undefined;

  constructor(collection: string, options?: CreateCollectionOptions) {
    super();
    this.collection = collection;
    this.validator = options?.validator;
    this.validationLevel = options?.validationLevel;
    this.validationAction = options?.validationAction;
    this.capped = options?.capped;
    this.size = options?.size;
    this.max = options?.max;
    this.timeseries = options?.timeseries;
    this.collation = options?.collation;
    this.changeStreamPreAndPostImages = options?.changeStreamPreAndPostImages;
    this.clusteredIndex = options?.clusteredIndex;
    this.freeze();
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
  readonly validator: Record<string, unknown> | undefined;
  readonly validationLevel: 'strict' | 'moderate' | undefined;
  readonly validationAction: 'error' | 'warn' | undefined;
  readonly changeStreamPreAndPostImages: { enabled: boolean } | undefined;

  constructor(collection: string, options: CollModOptions) {
    super();
    this.collection = collection;
    this.validator = options.validator;
    this.validationLevel = options.validationLevel;
    this.validationAction = options.validationAction;
    this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    this.freeze();
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
