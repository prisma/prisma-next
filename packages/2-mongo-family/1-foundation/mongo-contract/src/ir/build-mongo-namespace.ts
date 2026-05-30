import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import { MongoCollection } from './mongo-collection';
import type { MongoNamespace, MongoNamespaceCollectionsInput } from './mongo-storage';
import { MongoUnboundNamespace } from './mongo-unbound-namespace';

const MONGO_NAMESPACE_KIND = 'mongo-namespace' as const;

function isMaterializedMongoNamespace(
  ns: Namespace | MongoNamespaceCollectionsInput,
): ns is MongoNamespace {
  if (typeof ns !== 'object' || ns === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(ns);
  if (proto === Object.prototype || proto === null) {
    return false;
  }
  return (ns as Namespace).kind === MONGO_NAMESPACE_KIND;
}

class MongoBoundNamespace extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly collections: Readonly<Record<string, MongoCollection>>;

  static fromCollectionsInput(input: MongoNamespaceCollectionsInput): MongoNamespace {
    const collectionCount = Object.keys(input.collections ?? {}).length;
    if (input.id === UNBOUND_NAMESPACE_ID && collectionCount === 0) {
      return castAs<MongoNamespace>(MongoUnboundNamespace.instance);
    }
    return castAs<MongoNamespace>(new MongoBoundNamespace(input));
  }

  private constructor(input: MongoNamespaceCollectionsInput) {
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
      value: MONGO_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}

export function buildMongoNamespace(input: MongoNamespaceCollectionsInput): MongoNamespace {
  return MongoBoundNamespace.fromCollectionsInput(input);
}

export function buildMongoNamespaceMap(
  namespaces: Readonly<Record<string, Namespace | MongoNamespaceCollectionsInput>>,
): Readonly<Record<string, MongoNamespace>> {
  return Object.fromEntries(
    Object.entries(namespaces).map(([nsKey, ns]) => [
      nsKey,
      isMaterializedMongoNamespace(ns)
        ? blindCast<
            MongoNamespace,
            'a materialised Mongo-family namespace entry in a namespace map is a MongoNamespace'
          >(ns)
        : MongoBoundNamespace.fromCollectionsInput(ns),
    ]),
  );
}
