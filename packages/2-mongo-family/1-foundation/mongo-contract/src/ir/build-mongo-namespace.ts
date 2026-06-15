import {
  freezeNode,
  hydrateNamespaceEntities,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { composeMongoEntityKinds } from '../entity-kinds';
import type { MongoCollection } from './mongo-collection';
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

    const rawEntries = { collection: {}, ...input.entries };
    this.entries = Object.freeze(
      blindCast<MongoNamespaceEntries, 'hydrateNamespaceEntities produces MongoNamespaceEntries'>(
        hydrateNamespaceEntities(
          blindCast<
            Record<string, Readonly<Record<string, unknown>>>,
            'MongoNamespaceCollectionsInput.entries values are plain record maps'
          >(rawEntries),
          composeMongoEntityKinds(),
          'carry',
        ),
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

  get collection(): Readonly<Record<string, MongoCollection>> {
    return this.entries.collection ?? Object.freeze({});
  }
}

export function buildMongoNamespace(input: MongoNamespaceCollectionsInput): MongoNamespace {
  return MongoBoundNamespace.fromCollectionsInput(input);
}
