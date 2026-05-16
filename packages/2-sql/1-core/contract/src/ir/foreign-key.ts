import { freezeNode } from '@prisma-next/framework-components/ir';
import { ForeignKeyReference, type ForeignKeyReferenceInput } from './foreign-key-reference';
import { SqlNode } from './sql-node';

export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

/**
 * Inline plain-object type for the **source side** of a foreign key.
 * The source is always the containing table — there's no need for a
 * `namespaceId` here (the table's coordinate is implicit from the
 * `SqlStorage` parent slot the FK lives under), so the source only
 * carries the FK columns.
 */
export type ForeignKeySource = {
  readonly columns: readonly string[];
};

export interface ForeignKeyInput {
  /** Source-side columns. Inline plain object — no namespace coord. */
  readonly source: ForeignKeySource;
  /**
   * Reference target. Accepts an already-constructed
   * {@link ForeignKeyReference} or an inline input shape; the
   * constructor normalises to the class instance.
   */
  readonly target: ForeignKeyReference | ForeignKeyReferenceInput;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  /** Whether to emit FK constraint DDL (ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY). */
  readonly constraint: boolean;
  /** Whether to emit a backing index for the FK columns. */
  readonly index: boolean;
}

/**
 * SQL Contract IR node for a table-level foreign-key declaration.
 *
 * Decomposed into a clean source-vs-target shape:
 *
 * - {@link source} (`ForeignKeySource`): the inline plain object
 *   carrying the FK column list on the source side. The source's
 *   namespace coordinate is implicit (it is whichever namespace the
 *   containing {@link StorageTable} inhabits).
 * - {@link target} ({@link ForeignKeyReference}): the IR-class instance
 *   carrying the target table's `namespaceId`, `table`, and `columns`.
 *   Same-namespace FKs populate `target.namespaceId` with the source
 *   table's coordinate; cross-namespace FKs (M5b+) populate it with the
 *   target's distinct coordinate.
 *
 * FK-level metadata (`constraint`, `index`, `name`, `onDelete`,
 * `onUpdate`) stays at the `ForeignKey` level — none of it is
 * directional.
 *
 * The nested `target` field is normalised to a
 * {@link ForeignKeyReference} instance inside the constructor so
 * downstream walks see a uniform AST regardless of whether the input
 * was a JSON literal or an already-constructed class instance.
 */
export class ForeignKey extends SqlNode {
  readonly source: ForeignKeySource;
  readonly target: ForeignKeyReference;
  readonly constraint: boolean;
  readonly index: boolean;
  declare readonly name?: string;
  declare readonly onDelete?: ReferentialAction;
  declare readonly onUpdate?: ReferentialAction;

  constructor(input: ForeignKeyInput) {
    super();
    this.source = Object.freeze({ columns: input.source.columns });
    this.target =
      input.target instanceof ForeignKeyReference
        ? input.target
        : new ForeignKeyReference(input.target);
    this.constraint = input.constraint;
    this.index = input.index;
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    freezeNode(this);
  }
}
