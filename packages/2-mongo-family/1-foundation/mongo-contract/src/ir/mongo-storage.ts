import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  NamespaceBase,
  type Storage,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { MongoCollection, type MongoCollectionInput } from './mongo-collection';
import { MongoUnboundNamespace } from './mongo-unbound-namespace';

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly collections?: Record<string, MongoCollection | MongoCollectionInput>;
}

export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces?: Readonly<Record<string, Namespace | MongoNamespaceCollectionsInput>>;
}

const DEFAULT_NAMESPACES: Readonly<Record<string, Namespace>> = Object.freeze({
  [UNBOUND_NAMESPACE_ID]: MongoUnboundNamespace.instance,
});

class MongoNamespacePayload extends NamespaceBase {
  declare readonly kind?: string;

  readonly id: string;
  readonly collections: Readonly<Record<string, MongoCollection>>;

  constructor(input: MongoNamespaceCollectionsInput) {
    super();
    this.id = input.id;
    this.collections = Object.freeze(
      Object.fromEntries(
        Object.entries(input.collections ?? {}).map(([name, c]) => [
          name,
          c instanceof MongoCollection ? c : new MongoCollection(c),
        ]),
      ),
    );
    Object.defineProperty(this, 'kind', {
      value: 'mongo-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}

function normaliseNamespaceEntry(
  nsKey: string,
  ns: Namespace | MongoNamespaceCollectionsInput,
): Namespace {
  if (ns instanceof NamespaceBase) {
    return ns;
  }
  const collectionCount = Object.keys(ns.collections ?? {}).length;
  if (nsKey === UNBOUND_NAMESPACE_ID && collectionCount === 0) {
    return MongoUnboundNamespace.instance;
  }
  return new MongoNamespacePayload(ns as MongoNamespaceCollectionsInput);
}

// Mongo concretions always store `MongoCollection` instances in
// `collections` (Mongo idiom — distinct from the SQL family's `tables`).
// Narrowing the namespace map here lets target/family-level consumers
// iterate `namespaces[*].collections[*]` and recover the concrete
// collection type without the framework's wider `Namespace` tripping
// them up.
export type MongoNamespace = Namespace & {
  readonly collections: Readonly<Record<string, MongoCollection>>;
};

export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  readonly kind = 'mongo-storage' as const;
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(
      Object.fromEntries(
        Object.entries(input.namespaces ?? DEFAULT_NAMESPACES).map(([nsKey, ns]) => [
          nsKey,
          normaliseNamespaceEntry(nsKey, ns) as MongoNamespace,
        ]),
      ),
    );
    freezeNode(this);
  }
}
