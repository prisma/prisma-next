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

export interface MongoNamespaceTablesInput {
  readonly id: string;
  readonly tables?: Record<string, MongoCollection | MongoCollectionInput>;
}

export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces?: Readonly<Record<string, Namespace | MongoNamespaceTablesInput>>;
}

const DEFAULT_NAMESPACES: Readonly<Record<string, Namespace>> = Object.freeze({
  [UNBOUND_NAMESPACE_ID]: MongoUnboundNamespace.instance,
});

class MongoNamespacePayload extends NamespaceBase {
  declare readonly kind?: string;

  readonly id: string;
  readonly tables: Readonly<Record<string, MongoCollection>>;

  constructor(input: MongoNamespaceTablesInput) {
    super();
    this.id = input.id;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables ?? {}).map(([name, c]) => [
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
  ns: Namespace | MongoNamespaceTablesInput,
): Namespace {
  if (ns instanceof NamespaceBase) {
    return ns;
  }
  const tableCount = Object.keys(ns.tables ?? {}).length;
  if (nsKey === UNBOUND_NAMESPACE_ID && tableCount === 0) {
    return MongoUnboundNamespace.instance;
  }
  return new MongoNamespacePayload(ns as MongoNamespaceTablesInput);
}

export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  readonly kind = 'mongo-storage' as const;
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, Namespace>>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(
      Object.fromEntries(
        Object.entries(input.namespaces ?? DEFAULT_NAMESPACES).map(([nsKey, ns]) => [
          nsKey,
          normaliseNamespaceEntry(nsKey, ns),
        ]),
      ),
    );
    freezeNode(this);
  }
}
