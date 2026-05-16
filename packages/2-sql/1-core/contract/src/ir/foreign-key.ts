import { freezeNode } from '@prisma-next/framework-components/ir';
import { ForeignKeyReferences, type ForeignKeyReferencesInput } from './foreign-key-references';
import { SqlNode } from './sql-node';

export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export interface ForeignKeyInput {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences | ForeignKeyReferencesInput;
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
 * The nested `references` field is normalised to a
 * {@link ForeignKeyReferences} instance inside the constructor so
 * downstream walks see a uniform AST regardless of whether the input
 * was a JSON literal or an already-constructed class instance.
 */
export class ForeignKey extends SqlNode {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly constraint: boolean;
  readonly index: boolean;
  declare readonly name?: string;
  declare readonly onDelete?: ReferentialAction;
  declare readonly onUpdate?: ReferentialAction;

  constructor(input: ForeignKeyInput) {
    super();
    this.columns = input.columns;
    this.references =
      input.references instanceof ForeignKeyReferences
        ? input.references
        : new ForeignKeyReferences(input.references);
    this.constraint = input.constraint;
    this.index = input.index;
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    freezeNode(this);
  }
}
