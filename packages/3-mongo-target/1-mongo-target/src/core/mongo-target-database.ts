import { NamespaceBase } from '@prisma-next/framework-components/ir';

/**
 * Mongo target `Namespace` concretion. In Mongo the "namespace" concept
 * binds to the connection's `db` field — a `MongoTargetDatabase` instance
 * names the database the collections live under.
 *
 * Qualifier emission is the rendering seam: query / DDL emission asks the
 * namespace for its qualifier (e.g. `"<db>.<collection>"`) and consumes
 * the result polymorphically. The unspecified singleton overrides these
 * methods to elide the prefix entirely — call sites stay polymorphic and
 * never branch on `id === '__unspecified__'`.
 */
export class MongoTargetDatabase extends NamespaceBase {
  readonly kind = 'database' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    this.freeze();
  }

  /**
   * The bare qualifier as it would appear in a rendered string. The
   * unspecified-database singleton overrides this to return `''`.
   */
  qualifier(): string {
    return this.id;
  }

  /**
   * Qualify a collection name with the database prefix. The
   * unspecified-database singleton overrides this to emit just the
   * collection name. Used by emission/introspection paths that need a
   * fully-qualified reference.
   */
  qualifyCollection(collectionName: string): string {
    return `${this.id}.${collectionName}`;
  }
}

/**
 * Singleton subclass for the reserved sentinel namespace id
 * `'__unspecified__'`. Overrides qualifier emission to elide the
 * database prefix — call sites that consume `qualifier()` /
 * `qualifyCollection()` get unqualified output without branching on the
 * namespace id.
 *
 * This is the target-side materialization of "the framework provides
 * affordances; targets implement specifics": the framework names the
 * sentinel; Mongo decides what no-database-bound means here (the
 * collection name, naked).
 */
export class MongoTargetUnspecifiedDatabase extends MongoTargetDatabase {
  static readonly instance: MongoTargetUnspecifiedDatabase = new MongoTargetUnspecifiedDatabase();

  private constructor() {
    super('__unspecified__');
  }

  override qualifier(): string {
    return '';
  }

  override qualifyCollection(collectionName: string): string {
    return collectionName;
  }
}
