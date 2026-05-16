import { freezeNode, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface ForeignKeyReferenceInput {
  /**
   * Namespace coordinate the referenced table inhabits. Optional on the
   * input shape — when omitted the constructor defaults it to
   * {@link UNBOUND_NAMESPACE_ID} (the late-bound sentinel). For
   * same-namespace FKs the containing {@link StorageTable} constructor
   * pre-populates this field with its own `namespaceId` so the FK target
   * carries an unambiguous coordinate.
   */
  readonly namespaceId?: string;
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
 * The `namespaceId` field is **optional** on the IR class, mirroring
 * the `StorageTable.namespaceId` convention: same-namespace FKs whose
 * source table omits an explicit coordinate also omit the field on the
 * target (and the persisted JSON envelope stays byte-stable for the
 * single-namespace fixtures). The containing {@link StorageTable}
 * constructor pre-populates this field with the source table's
 * coordinate when the source carries one but the FK input did not.
 * Explicit non-default coordinates — and any future cross-namespace
 * lowerings — write the field enumerably.
 */
export class ForeignKeyReference extends SqlNode {
  /**
   * Namespace coordinate of the referenced table. Omitted (undefined)
   * when the source table inhabits the framework-default unbound slot
   * and the reference is same-namespace; written enumerably when the
   * coordinate is an explicit named namespace.
   */
  declare readonly namespaceId?: string;
  readonly table: string;
  readonly columns: readonly string[];

  constructor(input: ForeignKeyReferenceInput) {
    super();
    this.table = input.table;
    this.columns = input.columns;
    if (input.namespaceId !== undefined && input.namespaceId !== UNBOUND_NAMESPACE_ID) {
      Object.defineProperty(this, 'namespaceId', {
        value: input.namespaceId,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}
