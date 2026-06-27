import {
  buildNamespaceAccessor,
  buildSingleNamespaceView,
  composeContractView,
  type DefaultNamespaceEntries,
  type NamespaceAccessor,
  type SingleNamespaceView,
} from '@prisma-next/framework-components/ir';
import type { MongoContract } from './contract-types';

const MONGO_BUILTIN_KINDS = ['collection'] as const;
type MongoBuiltinKind = (typeof MONGO_BUILTIN_KINDS)[number];

type MongoEntries<TContract extends MongoContract> = DefaultNamespaceEntries<TContract['storage']>;

type MongoNamespaces<TContract extends MongoContract> = TContract['storage']['namespaces'];

/**
 * The Mongo accessors: the built-in `collection` kind promoted to a top-level
 * accessor, pack-contributed kinds under `entries` (singular keys).
 */
export type MongoContractAccessors<TContract extends MongoContract> = SingleNamespaceView<
  MongoEntries<TContract>,
  MongoBuiltinKind
>;

/**
 * A Mongo contract view: the deserialized contract intersected with the by-name
 * accessors, so the value is substitutable for `Contract` (carries `storage`,
 * `domain`, …) while also exposing:
 *  - `view.collection.<name>` — the built-in kind, default namespace unwrapped.
 *  - `view.entries.<kind>` — pack-contributed kinds (singular keys).
 *  - `view.namespace.<id>` — every namespace by raw id (Mongo's sole namespace
 *    is `__unbound__`), the fully-qualified collision-proof accessor.
 *
 * The factory (`MongoContractView.from` / `.fromJson`) lives in
 * `@prisma-next/family-mongo/ir`, where the Mongo serializer is reachable; this
 * package owns the serializer-agnostic projection type and builder.
 */
export type MongoContractView<TContract extends MongoContract = MongoContract> = TContract &
  MongoContractAccessors<TContract> & {
    readonly namespace: NamespaceAccessor<MongoNamespaces<TContract>, MongoBuiltinKind>;
  };

/**
 * Builds the Mongo view: unwraps the default namespace, promotes the built-in
 * `collection` kind at the root, attaches the `namespace` accessor, and layers
 * everything over the deserialized contract so the result is a structural
 * superset of the contract.
 */
export function buildMongoContractView<TContract extends MongoContract>(
  contract: TContract,
): MongoContractView<TContract> {
  const rootAccessors = buildSingleNamespaceView<MongoContractAccessors<TContract>>(
    contract.storage,
    MONGO_BUILTIN_KINDS,
  );
  const namespaceAccessor = buildNamespaceAccessor<
    NamespaceAccessor<MongoNamespaces<TContract>, MongoBuiltinKind>
  >(contract.storage, MONGO_BUILTIN_KINDS);
  return composeContractView<MongoContractView<TContract>>(
    contract,
    rootAccessors,
    namespaceAccessor,
  );
}
