import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaCollectionOptionsInput {
  readonly capped?: { size: number; max?: number };
  readonly timeseries?: {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
  };
  readonly collation?: Record<string, unknown>;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
  readonly clusteredIndex?: { name?: string };
}

export class MongoSchemaCollectionOptions extends MongoSchemaNode {
  readonly kind = 'collectionOptions' as const;
  readonly capped?: { size: number; max?: number } | undefined;
  readonly timeseries?:
    | { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' }
    | undefined;
  readonly collation?: Record<string, unknown> | undefined;
  readonly changeStreamPreAndPostImages?: { enabled: boolean } | undefined;
  readonly clusteredIndex?: { name?: string } | undefined;

  constructor(options: MongoSchemaCollectionOptionsInput) {
    super();
    this.capped = options.capped;
    this.timeseries = options.timeseries;
    this.collation = options.collation;
    this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    this.clusteredIndex = options.clusteredIndex;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.collectionOptions(this);
  }
}
