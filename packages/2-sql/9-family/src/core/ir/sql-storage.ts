import type { Namespace, Storage } from '@prisma-next/framework-components/ir';

/**
 * SQL family storage IR base. Refines the framework `Storage` interface
 * for SQL-shape persistence. The concrete element types of `tables` and
 * the optional `types` map are target-specific (`PostgresStorage`
 * carries `Record<string, PostgresTable>` etc.); the family base only
 * commits to the namespace map every SQL contract has.
 *
 * Keeping `tables` declared as an abstract concrete-class field at the
 * target layer (rather than a generic-typed base field) avoids leaking
 * SQL-target generics into framework consumers and matches the
 * `OpFactoryCall` precedent — the family base declares the interface;
 * the target ships the concrete shape.
 */
export abstract class SqlStorage implements Storage {
  abstract readonly namespaces: Readonly<Record<string, Namespace>>;
}
