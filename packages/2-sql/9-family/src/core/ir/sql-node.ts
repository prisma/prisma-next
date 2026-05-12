import { SchemaNodeBase } from '@prisma-next/framework-components/ir';

/**
 * SQL family IR-node base. Commits to the framework's SchemaNode contract
 * (string-typed `kind`) and inherits the framework's freeze() helper.
 *
 * Concrete IR node bases for SQL — `SqlTable`, `SqlColumn`, `SqlForeignKey`,
 * `SqlIndex`, `SqlPrimaryKey`, `SqlUnique`, `SqlEnumType` (M4) — extend this
 * class and declare their own `kind` discriminant. Targets (Postgres,
 * SQLite, …) extend the per-shape base classes with target-specific
 * concrete classes (see M3).
 */
export abstract class SqlNode extends SchemaNodeBase {}
