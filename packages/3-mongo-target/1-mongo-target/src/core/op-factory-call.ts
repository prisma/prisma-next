import type { MigrationOperationClass } from '@prisma-next/framework-components/control';
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

export type OpFactoryCall =
  | {
      readonly factory: 'createIndex';
      readonly collection: string;
      readonly keys: ReadonlyArray<MongoIndexKey>;
      readonly options?: CreateIndexOptions;
    }
  | {
      readonly factory: 'dropIndex';
      readonly collection: string;
      readonly keys: ReadonlyArray<MongoIndexKey>;
    }
  | {
      readonly factory: 'createCollection';
      readonly collection: string;
      readonly options?: CreateCollectionOptions;
    }
  | { readonly factory: 'dropCollection'; readonly collection: string }
  | {
      readonly factory: 'collMod';
      readonly collection: string;
      readonly options: CollModOptions;
      readonly meta?: CollModMeta;
    };

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
