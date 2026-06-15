import {
  freezeNode,
  hydrateNamespaceEntities,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type {
  MongoCollection,
  MongoCollectionInput,
  MongoNamespaceEntries,
} from '@prisma-next/mongo-contract';
import { composeMongoEntityKinds } from '@prisma-next/mongo-contract/entity-kinds';
import { blindCast } from '@prisma-next/utils/casts';

export interface MongoTargetDatabaseInput {
  readonly id: string;
  readonly entries?: Readonly<Record<string, Readonly<Record<string, MongoCollectionInput>>>>;
}

/**
 * Mongo target `Namespace` concretion. In Mongo the "namespace" concept
 * binds to the connection's `db` field — a `MongoTargetDatabase` instance
 * names the database the collections live under. `entries['collection']`
 * holds collection IR. The unbound singleton (below) is the late-bound
 * namespace whose binding the connection's `db` resolves at runtime rather
 * than at authoring time.
 *
 * Qualifier emission is the rendering seam: query / DDL emission asks the
 * namespace for its qualifier (e.g. `"<db>.<collection>"`) and consumes
 * the result polymorphically. The unbound singleton overrides these
 * methods to elide the prefix entirely — call sites stay polymorphic and
 * never branch on `id === UNBOUND_NAMESPACE_ID`.
 */
export class MongoTargetDatabase extends NamespaceBase {
  declare readonly kind: string;
  readonly id: string;
  readonly entries: MongoNamespaceEntries;

  constructor(input: MongoTargetDatabaseInput) {
    super();
    this.id = input.id;

    const rawEntries: Record<string, Readonly<Record<string, MongoCollectionInput>>> = {
      collection: {},
      ...input.entries,
    };
    this.entries = Object.freeze(
      blindCast<MongoNamespaceEntries, 'hydrateNamespaceEntities produces MongoNamespaceEntries'>(
        hydrateNamespaceEntities(
          blindCast<
            Record<string, Readonly<Record<string, unknown>>>,
            'MongoTargetDatabaseInput.entries values are plain record maps'
          >(rawEntries),
          composeMongoEntityKinds(),
          'carry',
        ),
      ),
    );
    Object.defineProperty(this, 'kind', {
      value: 'database',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get collection(): Readonly<Record<string, MongoCollection>> {
    return this.entries.collection ?? Object.freeze({});
  }

  /**
   * The bare qualifier as it would appear in a rendered string. The
   * unbound-database singleton overrides this to return `''`.
   */
  qualifier(): string {
    return this.id;
  }

  /**
   * Qualify a collection name with the database prefix. The
   * unbound-database singleton overrides this to emit just the
   * collection name. Used by emission/introspection paths that need a
   * fully-qualified reference.
   */
  qualifyCollection(collectionName: string): string {
    return `${this.id}.${collectionName}`;
  }
}

/**
 * Singleton subclass for the reserved sentinel namespace id
 * (`UNBOUND_NAMESPACE_ID`) — the late-bound namespace whose binding the
 * connection's `db` resolves at runtime. Overrides qualifier emission
 * to elide the database prefix; call sites that consume `qualifier()`
 * / `qualifyCollection()` get unqualified output without branching on
 * the namespace id.
 *
 * This is the target-side materialization of "the framework provides
 * affordances; targets implement specifics": the framework names the
 * sentinel; Mongo decides what late-bound means here (the collection
 * name, naked — the database is supplied by the live connection).
 */
export class MongoTargetUnboundDatabase extends MongoTargetDatabase {
  static readonly instance: MongoTargetUnboundDatabase = new MongoTargetUnboundDatabase();

  private constructor() {
    super({ id: UNBOUND_NAMESPACE_ID });
  }

  override qualifier(): string {
    return '';
  }

  override qualifyCollection(collectionName: string): string {
    return collectionName;
  }
}
