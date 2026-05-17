import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface ForeignKeyReferenceInput {
  /**
   * Namespace coordinate the referenced table inhabits. Required:
   * callers resolve the coordinate before construction (same-namespace
   * FKs stamp the source table's coordinate; cross-namespace FKs stamp
   * the target's). Use `UNBOUND_NAMESPACE_ID` for the late-bound slot.
   */
  readonly namespaceId: string;
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * SQL Contract IR node for the **referenced (target) side** of a single
 * foreign-key declaration.
 *
 * Splitting source vs. target on `ForeignKey` (rather than the legacy
 * `columns + references` shape) keeps the namespace coordinate
 * addressable on the target without fusing it into the table name. The
 * target carries three independent coordinates — `namespaceId`,
 * `table`, `columns` — which a future cross-contract-space lift can
 * extend additively to `(spaceId, namespaceId, table)` without
 * restructuring the IR.
 *
 * `namespaceId` is **required** on every reference: callers stamp the
 * resolved coordinate at construction time and the IR carries an
 * unambiguous `(namespaceId, table, columns)` triple end-to-end.
 */
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: string;
  readonly table: string;
  readonly columns: readonly string[];

  constructor(input: ForeignKeyReferenceInput) {
    super();
    if (input.namespaceId === undefined) {
      throw new Error(
        'ForeignKeyReference: `namespaceId` is required. Callers must resolve the namespace coordinate before construction (use `UNBOUND_NAMESPACE_ID` for the late-bound slot).',
      );
    }
    this.namespaceId = input.namespaceId;
    this.table = input.table;
    this.columns = input.columns;
    freezeNode(this);
  }
}
