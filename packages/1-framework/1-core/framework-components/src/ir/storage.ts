import type { Namespace } from './namespace';

/**
 * Framework-level promise that every Contract IR / Schema IR carries a
 * collection of namespaces keyed by namespace id. Family abstract bases
 * (`SqlStorage`, `MongoStorage`) refine the shape with family-specific
 * fields (tables, collections, enums, …); target concretions add target
 * fields where the family vocabulary doesn't reach.
 *
 * Keeping `namespaces` at the framework layer enforces that every storage
 * object — across any target — is namespace-scoped. The framework can
 * therefore walk the namespace map without knowing the family alphabet, and
 * the `(namespace.id, name)` keying that the verifier and planner depend on
 * is honest at every layer.
 */
export interface Storage {
  readonly namespaces: Readonly<Record<string, Namespace>>;
}
