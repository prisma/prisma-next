import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@prisma-next/framework-components/control';
import type {
  CollModOptions,
  CreateCollectionOptions,
  CreateIndexOptions,
  MongoIndexKey,
} from '@prisma-next/mongo-query-ast/control';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';

export interface CollModMeta {
  readonly id?: string;
  readonly label?: string;
  readonly operationClass?: MigrationOperationClass;
}

export interface OpFactoryCallVisitor<R> {
  createIndex(call: CreateIndexCall): R;
  dropIndex(call: DropIndexCall): R;
  createCollection(call: CreateCollectionCall): R;
  dropCollection(call: DropCollectionCall): R;
  collMod(call: CollModCall): R;
}

abstract class OpFactoryCallNode implements FrameworkOpFactoryCall {
  abstract readonly factory: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract accept<R>(visitor: OpFactoryCallVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

export class CreateIndexCall extends OpFactoryCallNode {
  readonly factory = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly options: CreateIndexOptions | undefined;
  readonly label: string;

  constructor(
    collection: string,
    keys: ReadonlyArray<MongoIndexKey>,
    options?: CreateIndexOptions,
  ) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.options = options;
    this.label = `Create index on ${collection} (${formatKeys(keys)})`;
    this.freeze();
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

export class DropIndexCall extends OpFactoryCallNode {
  readonly factory = 'dropIndex' as const;
  readonly operationClass = 'destructive' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly label: string;

  constructor(collection: string, keys: ReadonlyArray<MongoIndexKey>) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.label = `Drop index on ${collection} (${formatKeys(keys)})`;
    this.freeze();
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}

export class CreateCollectionCall extends OpFactoryCallNode {
  readonly factory = 'createCollection' as const;
  readonly operationClass = 'additive' as const;
  readonly collection: string;
  readonly options: CreateCollectionOptions | undefined;
  readonly label: string;

  constructor(collection: string, options?: CreateCollectionOptions) {
    super();
    this.collection = collection;
    this.options = options;
    this.label = `Create collection ${collection}`;
    this.freeze();
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.createCollection(this);
  }
}

export class DropCollectionCall extends OpFactoryCallNode {
  readonly factory = 'dropCollection' as const;
  readonly operationClass = 'destructive' as const;
  readonly collection: string;
  readonly label: string;

  constructor(collection: string) {
    super();
    this.collection = collection;
    this.label = `Drop collection ${collection}`;
    this.freeze();
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.dropCollection(this);
  }
}

export class CollModCall extends OpFactoryCallNode {
  readonly factory = 'collMod' as const;
  readonly collection: string;
  readonly options: CollModOptions;
  readonly meta: CollModMeta | undefined;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;

  constructor(collection: string, options: CollModOptions, meta?: CollModMeta) {
    super();
    this.collection = collection;
    this.options = options;
    this.meta = meta;
    this.operationClass = meta?.operationClass ?? 'destructive';
    this.label = meta?.label ?? `Modify collection ${collection}`;
    this.freeze();
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.collMod(this);
  }
}

export type OpFactoryCall =
  | CreateIndexCall
  | DropIndexCall
  | CreateCollectionCall
  | DropCollectionCall
  | CollModCall;

export function schemaIndexToCreateIndexOptions(index: MongoSchemaIndex): CreateIndexOptions {
  return {
    unique: index.unique || undefined,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
    wildcardProjection: index.wildcardProjection,
    collation: index.collation,
    weights: index.weights,
    default_language: index.default_language,
    language_override: index.language_override,
  };
}

export function schemaCollectionToCreateCollectionOptions(
  coll: MongoSchemaCollection,
): CreateCollectionOptions | undefined {
  const opts: MongoSchemaCollectionOptions | undefined = coll.options;
  const validator: MongoSchemaValidator | undefined = coll.validator;
  if (!opts && !validator) return undefined;
  return {
    capped: opts?.capped ? true : undefined,
    size: opts?.capped?.size,
    max: opts?.capped?.max,
    timeseries: opts?.timeseries,
    collation: opts?.collation,
    clusteredIndex: opts?.clusteredIndex
      ? {
          key: { _id: 1 } as Record<string, number>,
          unique: true as boolean,
          ...(opts.clusteredIndex.name != null ? { name: opts.clusteredIndex.name } : {}),
        }
      : undefined,
    validator: validator ? { $jsonSchema: validator.jsonSchema } : undefined,
    validationLevel: validator?.validationLevel,
    validationAction: validator?.validationAction,
    changeStreamPreAndPostImages: opts?.changeStreamPreAndPostImages,
  };
}
