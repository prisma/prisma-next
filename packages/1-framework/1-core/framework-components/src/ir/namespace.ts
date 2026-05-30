import { type IRNode, IRNodeBase } from './ir-node';

/**
 * Reserved sentinel namespace id for the late-bound storage slot —
 * the slot whose binding the target resolves at connection time
 * rather than at authoring time. Postgres uses it for `search_path`
 * late binding; SQLite uses it for the trivial singleton; Mongo uses
 * it for the connection's `db` binding.
 *
 * Materialised target-side as a singleton subclass of the target's
 * `NamespaceBase` concretion that overrides the namespace's
 * qualifier-emission methods to elide the prefix entirely. Call sites
 * stay polymorphic and never branch on `id === UNBOUND_NAMESPACE_ID`
 * — the singleton's overrides drop the qualifier so emitted SQL / Mongo
 * commands look unqualified.
 *
 * The double-underscore decoration marks the id as a framework-reserved
 * coordinate when it appears in a JSON envelope (cold-read-as-reserved
 * — no realistic collision with user-declared namespace names).
 *
 * Encoded as an exported const (rather than scattered string literals)
 * so the sentinel-id invariant is single-sourced: any production-source
 * site that constructs an unbound-namespace singleton imports this
 * constant.
 */
export const UNBOUND_NAMESPACE_ID = '__unbound__' as const;

/**
 * Framework-level building block for a "namespace" — the database-level
 * grouping under which storage objects (tables, collections, enums, …)
 * reside. Each target's namespace concretion maps the framework concept to
 * a target-native binding:
 *
 * - Postgres: a schema (`CREATE SCHEMA …`); rendered as `"<schema>"`.
 * - SQLite: the singleton `UNBOUND_NAMESPACE_ID`; emitted SQL has no qualifier.
 * - Mongo: the connection's `db` field; addressed as a database name.
 *
 * See `UNBOUND_NAMESPACE_ID` above for the sentinel id and the
 * singleton-subclass pattern that materialises it.
 *
 * The framework promises only the coordinate (`id`) — the named storage
 * entities a namespace contains are family-typed (SQL contributes
 * `tables`, Mongo contributes `collections`, future families pick their
 * own native idiom). Generic consumers walking "all named entries" go
 * through a family-typed namespace, not the framework `Namespace`.
 *
 * Every namespace concretion (e.g. family-built SQL namespaces,
 * `MongoUnboundNamespace`, target-promoted namespaces like
 * `PostgresSchema`) carries exactly: `id` (enumerable string), `kind`
 * (non-enumerable string discriminator set via `Object.defineProperty`),
 * and one or more entity-kind slot maps — each an own-enumerable property
 * whose key is the entity kind (`tables`, `types`, `collections`,
 * target-pack-contributed slot names) and whose value is a
 * `Record<entityName, EntityIRClass>`. No other own-enumerable data lives
 * on a namespace; non-entity computed data lives on the surrounding storage
 * or contract IR. The framework's `elementCoordinates(storage)` walk relies
 * on this invariant to enumerate entities structurally without
 * family-specific knowledge.
 */
export interface Namespace extends IRNode {
  readonly id: string;
  readonly kind: string;
}

export abstract class NamespaceBase extends IRNodeBase implements Namespace {
  abstract readonly id: string;
  abstract override readonly kind: string;
}
