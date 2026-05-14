import { SqlNode } from './sql-node';

/**
 * SQL family foreign-key IR base. Placeholder abstract for future
 * SQL-family foreign-key subclasses; today the family-shared concrete
 * foreign-key class lives at `@prisma-next/sql-contract/types` as
 * `ForeignKey` (one class shared by all SQL targets).
 *
 * A future milestone introduces a namespace-aware reference shape
 * (cross-namespace coordinates on top of `(table, columns)`) when
 * namespace-keyed storage lands; the reference coordinate is
 * intentionally kept opaque on the base so targets can carry richer
 * fields (`onDelete` / `onUpdate` actions, action match modes) without
 * reshaping the family base.
 */
export abstract class SqlForeignKey extends SqlNode {
  abstract readonly columns: readonly string[];
}
