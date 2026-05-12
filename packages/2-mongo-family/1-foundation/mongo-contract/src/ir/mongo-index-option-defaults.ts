import { SchemaNodeBase } from '@prisma-next/framework-components/ir';
import type { MongoJsonObject } from '../contract-types';

export interface MongoIndexOptionDefaultsInput {
  readonly storageEngine?: MongoJsonObject;
}

/**
 * Collection-level default index options (the `indexOptionDefaults`
 * collection-creation field on Mongo's `createCollection`). Lifted from
 * a `type =` data shape to an AST class extending `SchemaNodeBase` per
 * FR18 (Mongo Contract IR fully unified under the AST-class pattern).
 *
 * Carries `storageEngine` only — the underlying MongoDB option set is
 * intentionally narrow at this layer; per-engine richer option vocabularies
 * are out of scope for this project.
 */
export class MongoIndexOptionDefaults extends SchemaNodeBase {
  readonly kind = 'mongo-index-option-defaults' as const;
  declare readonly storageEngine?: MongoJsonObject;

  constructor(options: MongoIndexOptionDefaultsInput = {}) {
    super();
    if (options.storageEngine !== undefined) this.storageEngine = options.storageEngine;
    this.freeze();
  }
}
