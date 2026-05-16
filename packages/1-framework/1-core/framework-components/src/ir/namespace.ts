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
 */
export interface Namespace extends IRNode {
  readonly id: string;

  /**
   * Resolve the default namespace coordinate a top-level (un-namespaced)
   * storage object belongs to in this target's semantics.
   *
   * The dispatch site (per-target planner / emitter) reads
   * `storage.namespaces[UNBOUND_NAMESPACE_ID]?.resolveDefaultNamespaceForTopLevel(storage.namespaces)`.
   * Each target's unbound-namespace concretion owns the policy:
   *
   * - Postgres (`PostgresUnboundSchema`): returns `'public'` when the
   *   contract declared a `public` namespace (FR16c implicit default for
   *   top-level models), else `UNBOUND_NAMESPACE_ID` (search_path resolves
   *   at runtime).
   * - SQLite (`SqliteUnboundDatabase`) / Mongo (`MongoTargetUnboundDatabase`):
   *   return `undefined` — the singleton owns every table; the planner
   *   falls back to whatever connection-supplied schema name it carries
   *   without a per-namespace default-resolution step.
   *
   * The framework default (`NamespaceBase.resolveDefaultNamespaceForTopLevel`)
   * returns `undefined`, matching the SQLite / Mongo singleton policy.
   * Targets override on their per-target concretion when they want a
   * named-default policy.
   */
  resolveDefaultNamespaceForTopLevel(
    allNamespaces: Readonly<Record<string, Namespace>>,
  ): string | undefined;
}

export abstract class NamespaceBase extends IRNodeBase implements Namespace {
  abstract readonly id: string;

  resolveDefaultNamespaceForTopLevel(
    _allNamespaces: Readonly<Record<string, Namespace>>,
  ): string | undefined {
    return undefined;
  }
}
