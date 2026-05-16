import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';

/**
 * Mongo target `Namespace` concretion. In Mongo the "namespace" concept
 * binds to the connection's `db` field — a `MongoTargetDatabase` instance
 * names the database the collections live under. The unbound singleton
 * (below) is the late-bound slot whose binding the connection's `db`
 * resolves at runtime rather than at authoring time.
 *
 * Qualifier emission is the rendering seam: query / DDL emission asks the
 * namespace for its qualifier (e.g. `"<db>.<collection>"`) and consumes
 * the result polymorphically. The unbound singleton overrides these
 * methods to elide the prefix entirely — call sites stay polymorphic and
 * never branch on `id === UNBOUND_NAMESPACE_ID`.
 *
 * **Freeze-trap warning.** The constructor calls `freezeNode(this)` at
 * the end. Direct subclasses MUST NOT add instance fields — the freeze
 * runs in this base constructor and any subclass field assignment will
 * silently fail in non-strict mode or throw in strict mode. The
 * `MongoTargetUnboundDatabase` singleton below is intentionally
 * field-free for this reason; if a future subclass needs to carry
 * additional fields, lift this `freezeNode` to the leaf-class
 * constructors (or to a `seal()` hook each leaf calls explicitly).
 */
export class MongoTargetDatabase extends NamespaceBase {
  readonly kind = 'database' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
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
 * (`UNBOUND_NAMESPACE_ID`) — the late-bound slot whose binding the
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
    super(UNBOUND_NAMESPACE_ID);
  }

  override qualifier(): string {
    return '';
  }

  override qualifyCollection(collectionName: string): string {
    return collectionName;
  }
}
