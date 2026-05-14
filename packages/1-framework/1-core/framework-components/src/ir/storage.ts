import type { IRNode } from './ir-node';
import type { Namespace } from './namespace';

/**
 * Framework-level promise that every Contract IR / Schema IR carries a
 * collection of namespaces keyed by namespace id. Family abstract bases
 * (`SqlStorage`, `MongoStorageBase`) refine the shape with family-specific
 * fields (tables, collections, enums, …); target concretions add target
 * fields where the family vocabulary doesn't reach.
 *
 * Keeping `namespaces` at the framework layer enforces that every storage
 * object — across any target — is namespace-scoped. The framework can
 * therefore walk the namespace map without knowing the family alphabet, and
 * the `(namespace.id, name)` keying that the verifier and planner depend on
 * is honest at every layer.
 *
 * Extends `IRNode` so the framework's IR-walking surfaces (verifiers,
 * serializers) can dispatch on `Storage`-typed slots through the same
 * IR-node alphabet as every other node — the structural dual already
 * holds in code (every concrete storage class extends an IR-node base);
 * the interface promotion makes the typing honest.
 */
export interface Storage extends IRNode {
  readonly namespaces: Readonly<Record<string, Namespace>>;
}
