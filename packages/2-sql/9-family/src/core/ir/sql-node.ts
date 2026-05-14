import { SchemaNodeBase } from '@prisma-next/framework-components/ir';

/**
 * SQL family IR-node base. Placeholder abstract for future SQL-family
 * IR-node subclasses; today the family-shared concrete IR-node base
 * lives at `@prisma-next/sql-contract/types` as `SqlNode` (one class
 * shared by all SQL targets, carrying the family-level
 * `kind = 'sql'` discriminator).
 *
 * Future per-shape SQL-family abstracts (e.g. an enum-type base when a
 * polymorphic walker earns it) extend this class and declare their own
 * narrower `kind` literals.
 */
export abstract class SqlNode extends SchemaNodeBase {}
