import { type SchemaNode, SchemaNodeBase } from './schema-node';

/**
 * Framework-level building block for a "namespace" — the database-level
 * grouping under which storage objects (tables, collections, enums, …)
 * reside. Each target's namespace concretion maps the framework concept to
 * a target-native binding:
 *
 * - Postgres: a schema (`CREATE SCHEMA …`); rendered as `"<schema>"`.
 * - SQLite: the singleton `__unspecified__`; emitted SQL has no qualifier.
 * - Mongo: the connection's `db` field; addressed as a database name.
 *
 * The reserved sentinel id `'__unspecified__'` represents
 * "no namespace bound at authoring time; resolve from connection context".
 * It is materialised target-side as a singleton subclass that overrides the
 * namespace's qualifier-emission methods to elide the prefix entirely; call
 * sites stay polymorphic and never branch on `id === '__unspecified__'`.
 */
export interface Namespace extends SchemaNode {
  readonly id: string;
}

export abstract class NamespaceBase extends SchemaNodeBase implements Namespace {
  abstract readonly id: string;
}
