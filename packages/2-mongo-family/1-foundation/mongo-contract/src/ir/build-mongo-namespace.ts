import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { MongoCollection, type MongoCollectionInput } from './mongo-collection';
import type {
  MongoNamespace,
  MongoNamespaceCollectionsInput,
  MongoNamespaceEntries,
} from './mongo-storage';
import { MongoUnboundNamespace } from './mongo-unbound-namespace';

const MONGO_NAMESPACE_KIND = 'mongo-namespace' as const;

class MongoBoundNamespace extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: MongoNamespaceEntries;

  static fromCollectionsInput(input: MongoNamespaceCollectionsInput): MongoNamespace {
    const collectionMap = input.entries['collection'];
    const collectionCount = collectionMap !== undefined ? Object.keys(collectionMap).length : 0;
    const hasUnknownKinds = Object.keys(input.entries).some((kind) => kind !== 'collection');
    if (input.id === UNBOUND_NAMESPACE_ID && collectionCount === 0 && !hasUnknownKinds) {
      return MongoUnboundNamespace.instance;
    }
    return new MongoBoundNamespace(input);
  }

  private constructor(input: MongoNamespaceCollectionsInput) {
    super();
    this.id = input.id;

    const carried: Record<string, Readonly<Record<string, unknown>>> = {};
    let collection: Readonly<Record<string, MongoCollection>> = Object.freeze({});
    for (const [kind, rawMap] of Object.entries(input.entries)) {
      if (kind === 'collection') {
        const collectionMap: Record<string, MongoCollection> = {};
        for (const [name, c] of Object.entries(
          blindCast<
            Record<string, MongoCollectionInput>,
            'entries[collection] holds MongoCollectionInput by construction'
          >(rawMap),
        )) {
          collectionMap[name] = new MongoCollection(c);
        }
        collection = Object.freeze(collectionMap);
      } else {
        carried[kind] = Object.freeze(rawMap);
      }
    }

    this.entries = Object.freeze({ ...carried, collection });
    Object.defineProperty(this, 'kind', {
      value: MONGO_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get collection(): Readonly<Record<string, MongoCollection>> {
    return this.entries.collection ?? Object.freeze({});
  }
}

export function buildMongoNamespace(input: MongoNamespaceCollectionsInput): MongoNamespace {
  return MongoBoundNamespace.fromCollectionsInput(input);
}
