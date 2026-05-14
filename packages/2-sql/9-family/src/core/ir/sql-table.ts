import { SqlNode } from './sql-node';

/**
 * SQL family table IR base. Placeholder abstract for future SQL-family
 * table subclasses; today the family-shared concrete table class lives
 * at `@prisma-next/sql-contract/types` as `StorageTable` (one class
 * shared by all SQL targets).
 *
 * Today's flat-data SQL storage tables carry neither `name`
 * (`StorageTable` is keyed by name in `SqlStorage.tables`) nor a
 * namespace coordinate. A future milestone introduces namespace-keyed
 * storage and the per-target table subclass that earns its own
 * concretion (e.g. when a target adds a target-specific derived field
 * on the table); the namespace shape will be declared on this base at
 * that point.
 */
export abstract class SqlTable extends SqlNode {}
