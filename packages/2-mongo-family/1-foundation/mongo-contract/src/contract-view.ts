import {
  buildSingleNamespaceView,
  type DefaultNamespaceEntries,
  type SingleNamespaceView,
} from '@prisma-next/framework-components/ir';
import type { MongoContract } from './contract-types';

const MONGO_BUILTIN_KINDS = ['collection'] as const;
type MongoBuiltinKind = (typeof MONGO_BUILTIN_KINDS)[number];

type MongoEntries<TContract extends MongoContract> = DefaultNamespaceEntries<TContract['storage']>;

export type MongoContractViewShape<TContract extends MongoContract> = SingleNamespaceView<
  MongoEntries<TContract>,
  MongoBuiltinKind
>;

/**
 * A read-only view over a deserialized Mongo contract that unwraps the
 * default namespace and promotes the built-in `collection` kind to the
 * top level.
 *
 * Usage:
 * ```ts
 * const cv = MongoContractView.from(endContract);
 * cv.collection.carts   // typed MongoCollection
 * cv.entries.policy.X   // pack-contributed kind (singular key)
 * ```
 *
 * The `Contract` type is unchanged — this view is a separate object layered
 * on top of the raw deserialized contract. The default-namespace unwrap and
 * built-in-kind promotion are the generic single-namespace projection from
 * `@prisma-next/framework-components`; Mongo only supplies its built-in kind
 * set (`collection`).
 */
export class MongoContractView {
  private constructor() {}

  static from<TContract extends MongoContract>(
    contract: TContract,
  ): MongoContractViewShape<TContract> {
    return buildSingleNamespaceView<MongoContractViewShape<TContract>>(
      contract.storage,
      MONGO_BUILTIN_KINDS,
    );
  }
}
