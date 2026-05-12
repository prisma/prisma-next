import type { Namespace, Storage } from '@prisma-next/framework-components/ir';

/**
 * Mongo family storage IR abstract base. Refines the framework `Storage`
 * interface for collection-shaped persistence. The framework promise
 * (`namespaces: Readonly<Record<string, Namespace>>`) lives here; concrete
 * family/target storage classes (`MongoTargetStorage`) add `collections`
 * and any other family/target-specific maps on top.
 *
 * Mongo's namespace concept maps to the connection's `db` field —
 * concretized in M2 as `MongoTargetDatabase` (a `NamespaceBase` subclass)
 * with the singleton subclass `MongoTargetUnspecifiedDatabase` for
 * connection-bound binding. The default storage carries
 * `namespaces: { __unspecified__: MongoTargetUnspecifiedDatabase.instance }`.
 *
 * Named `MongoStorageBase` (rather than `MongoStorage`) to avoid a
 * package-internal naming collision with the existing `type MongoStorage`
 * data shape in `contract-types`, and to follow the codebase's `*Base`
 * convention for abstract IR-side bases (`SchemaNodeBase`, `NamespaceBase`,
 * `MongoContractSerializerBase`, `MongoSchemaVerifierBase`).
 */
export abstract class MongoStorageBase implements Storage {
  abstract readonly namespaces: Readonly<Record<string, Namespace>>;
}
