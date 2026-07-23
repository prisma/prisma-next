import { freezeNode } from '@prisma-next/framework-components/ir';
import { formatWireName, parseWireName } from '@prisma-next/sql-schema-ir/naming';
import { SqlNode } from './sql-node';

export interface IndexInput {
  /** Full wire name (managed) or verbatim physical name (exact). Always present. */
  readonly name: string;
  /** The user-typed (or default-derived) prefix. Present iff managed. */
  readonly prefix?: string;
  /** Column-tuple elements. Exactly one of `columns` / `expression` is set. */
  readonly columns?: readonly string[];
  /**
   * Opaque SQL: the entire element list between the parens of CREATE INDEX —
   * one string, never parsed.
   */
  readonly expression?: string;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where?: string;
  /** Rendered as CREATE UNIQUE INDEX. */
  readonly unique: boolean;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

/**
 * SQL Contract IR node for a table-level secondary index, name-identified:
 * `name` is the full physical name; a present `prefix` marks the index as
 * managed (`name` is `formatWireName(prefix, <8hex>)`), an absent `prefix`
 * marks it exact (the name is adopted verbatim).
 *
 * Note that this class shadows the global TypeScript `Index` lib type
 * at the family-shared name; consumer files that need both should
 * alias one (e.g.
 * `import { Index as SqlIndexNode } from '@prisma-next/sql-contract/types'`).
 */
export class Index extends SqlNode {
  readonly name: string;
  readonly unique: boolean;
  declare readonly prefix?: string;
  declare readonly columns?: readonly string[];
  declare readonly expression?: string;
  declare readonly where?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;

  constructor(input: IndexInput) {
    super();
    if (input.name === undefined || input.name.length === 0) {
      throw new Error(
        'Index: every index carries a full physical name; an expression index must be explicitly named (a default name cannot be derived from an expression).',
      );
    }
    if ((input.columns === undefined) === (input.expression === undefined)) {
      throw new Error(`Index "${input.name}": exactly one of columns or expression must be set.`);
    }
    if (input.prefix !== undefined) {
      const parsed = parseWireName(input.name);
      if (parsed === undefined || parsed.prefix !== input.prefix) {
        throw new Error(
          `Index "${input.name}": prefix "${input.prefix}" does not match the wire name (expected "${formatWireName(input.prefix, '<8hex>')}").`,
        );
      }
    }
    this.name = input.name;
    this.unique = input.unique;
    if (input.prefix !== undefined) this.prefix = input.prefix;
    if (input.columns !== undefined) this.columns = input.columns;
    if (input.expression !== undefined) this.expression = input.expression;
    if (input.where !== undefined) this.where = input.where;
    if (input.type !== undefined) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    freezeNode(this);
  }
}
