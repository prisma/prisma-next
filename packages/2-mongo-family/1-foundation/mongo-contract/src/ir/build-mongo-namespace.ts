import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { MongoCollection } from './mongo-collection';
import type { MongoNamespace, MongoNamespaceCollectionsInput } from './mongo-storage';
import { MongoUnboundNamespace } from './mongo-unbound-namespace';

class MongoNamespaceFromCollectionsInput extends NamespaceBase {
  declare readonly kind: string;

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

export function buildMongoNamespace(input: MongoNamespaceCollectionsInput): MongoNamespace {
  const collectionCount = Object.keys(input.collections ?? {}).length;
  if (input.id === UNBOUND_NAMESPACE_ID && collectionCount === 0) {
    return MongoUnboundNamespace.instance as MongoNamespace;
  }
  return new MongoNamespaceFromCollectionsInput(input) as MongoNamespace;
}

export function buildMongoNamespaceMap(
  namespaces: Readonly<Record<string, Namespace | MongoNamespaceCollectionsInput>>,
): Readonly<Record<string, MongoNamespace>> {
  return Object.fromEntries(
    Object.entries(namespaces).map(([nsKey, ns]) => [
      nsKey,
      ns instanceof NamespaceBase ? (ns as MongoNamespace) : buildMongoNamespace(ns),
    ]),
  );
}
