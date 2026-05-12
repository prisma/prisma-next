import { SqlNode } from './sql-node';

/**
 * SQL family foreign-key IR base. Carries the local-column list and the
 * referenced (namespace.id, table, column) coordinate. The
 * namespace-aware reference shape is M5b's load-bearing addition; M1
 * declares the abstract field shape but defers concrete coordinate types
 * to the target layer so M5b can introduce the cross-namespace coordinate
 * as a target concretion without reshaping the family base.
 *
 * The reference coordinate is intentionally kept as an opaque
 * `SqlForeignKeyReference` shape on the base; targets may carry richer
 * fields (e.g. `onDelete` / `onUpdate` actions, action match modes).
 */
export abstract class SqlForeignKey extends SqlNode {
  abstract readonly columns: readonly string[];
}
