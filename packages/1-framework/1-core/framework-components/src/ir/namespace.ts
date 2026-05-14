import { type IRNode, IRNodeBase } from './ir-node';

/**
 * Reserved sentinel namespace id meaning
 * "no namespace bound at authoring time; resolve from connection context".
 *
 * Materialised target-side as a singleton subclass of the target's
 * `NamespaceBase` concretion that overrides the namespace's
 * qualifier-emission methods to elide the prefix entirely. Call sites
 * stay polymorphic and never branch on `id === UNSPECIFIED_NAMESPACE_ID`
 * — the singleton's overrides drop the qualifier so emitted SQL / Mongo
 * commands look unqualified.
 *
 * Encoded as an exported const (rather than scattered string literals)
 * so the sentinel-id invariant is single-sourced: any production-source
 * site that constructs an unspecified-namespace singleton imports this
 * constant.
 */
export const UNSPECIFIED_NAMESPACE_ID = '__unspecified__' as const;

/**
 * Framework-level building block for a "namespace" — the database-level
 * grouping under which storage objects (tables, collections, enums, …)
 * reside. Each target's namespace concretion maps the framework concept to
 * a target-native binding:
 *
 * - Postgres: a schema (`CREATE SCHEMA …`); rendered as `"<schema>"`.
 * - SQLite: the singleton `UNSPECIFIED_NAMESPACE_ID`; emitted SQL has no qualifier.
 * - Mongo: the connection's `db` field; addressed as a database name.
 *
 * See `UNSPECIFIED_NAMESPACE_ID` above for the sentinel id and the
 * singleton-subclass pattern that materialises it.
 */
export interface Namespace extends IRNode {
  readonly id: string;
}

export abstract class NamespaceBase extends IRNodeBase implements Namespace {
  abstract readonly id: string;
}
