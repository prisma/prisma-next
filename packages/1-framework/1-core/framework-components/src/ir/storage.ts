import type { IRNode } from './ir-node';
import type { Namespace } from './namespace';

/**
 * Framework-level promise that every Contract IR / Schema IR carries a
 * collection of namespaces keyed by namespace id. Family storage
 * concretions (`SqlStorage`, `MongoStorage`) refine the shape with
 * family-specific fields (tables, collections, enums, …); target
 * concretions add target fields where the family vocabulary doesn't
 * reach.
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
 *
 * **Persisted envelope shape is target-owned, not framework-promised.**
 * Whether the `namespaces` map appears in the on-disk JSON envelope is
 * a per-target decision made by `ContractSerializer.serializeContract`.
 * Some targets emit a JSON-clean namespace shape that round-trips
 * through `JSON.stringify` cleanly (SQL today via the family-layer
 * identity serializer); others ship runtime-only fields on their
 * namespace concretions and override `serializeContract` to strip
 * them (Mongo). Future open (F16): extend the per-target
 * `ContractSerializer` integration-test surface with an explicit
 * envelope-shape assertion for each target, so the strip-vs-pass-through
 * choice is locked at test time rather than implied by the override
 * presence/absence. Earned by PR2's per-target namespace lift, when
 * `PostgresSchema` / `SqliteUnboundDatabase` start carrying
 * target-specific fields.
 */
export interface Storage extends IRNode {
  readonly namespaces: Readonly<Record<string, Namespace>>;
}
