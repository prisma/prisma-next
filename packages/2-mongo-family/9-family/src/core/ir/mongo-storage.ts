import { IRNodeBase, type Namespace, type Storage } from '@prisma-next/framework-components/ir';

/**
 * Mongo family storage IR abstract base. Refines the framework `Storage`
 * interface for collection-shaped persistence. The framework promise
 * (`namespaces: Readonly<Record<string, Namespace>>`) lives here; concrete
 * family/target storage classes (`MongoTargetStorage`) add `collections`
 * and any other family/target-specific maps on top.
 *
 * Mongo's namespace concept maps to the connection's `db` field —
 * concretized as `MongoTargetDatabase` (a `NamespaceBase` subclass) with
 * the singleton subclass `MongoTargetUnspecifiedDatabase` for
 * connection-bound binding. The default storage carries
 * `namespaces: { [UNSPECIFIED_NAMESPACE_ID]: MongoTargetUnspecifiedDatabase.instance }`.
 *
 * Extends `IRNodeBase` so concrete target-storage subclasses can use
 * the framework `freezeNode` helper consistently with the rest of the
 * IRNodeBase-derived IR.
 *
 * Named `MongoStorageBase` (rather than `MongoStorage`) to avoid a
 * package-internal naming collision with the existing `type MongoStorage`
 * data shape in `contract-types`, and to follow the codebase's `*Base`
 * convention for abstract IR-side bases (`IRNodeBase`, `NamespaceBase`,
 * `MongoContractSerializerBase`, `MongoSchemaVerifierBase`).
 */
export abstract class MongoStorageBase extends IRNodeBase implements Storage {
  readonly kind?: string;
  abstract readonly namespaces: Readonly<Record<string, Namespace>>;
}
