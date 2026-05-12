import type { Namespace, Storage } from '@prisma-next/framework-components/ir';

/**
 * Mongo family storage IR base. Refines the framework `Storage` interface
 * for collection-shaped persistence. The concrete element types of
 * `collections` and any future Mongo-shape maps live on the target
 * concretion (`MongoTargetStorage`), keeping family generics out of the
 * framework consumer surface.
 *
 * Mongo's namespace concept maps to the connection's `db` field —
 * concretized in M2 as `MongoTargetDatabase` (a `NamespaceBase` subclass)
 * with the singleton subclass `MongoTargetUnspecifiedDatabase` for
 * connection-bound binding. The default storage carries
 * `namespaces: { __unspecified__: MongoTargetUnspecifiedDatabase.instance }`.
 */
export abstract class MongoStorage implements Storage {
  abstract readonly namespaces: Readonly<Record<string, Namespace>>;
}
