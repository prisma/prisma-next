import { freezeNode } from '@prisma-next/framework-components/ir';
import type { SqlAnnotations } from './sql-column-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';
import { SqlTableIR, type SqlTableIRInput } from './sql-table-ir';

/**
 * Target discriminant for a schema-root IR node. `'sql'` is the
 * target-agnostic generic root (SQLite uses it directly); target-specific
 * concretions set their own id (e.g. Postgres → `'postgres'`). It is an
 * enumerable own field so it survives a `{ ...schema }` spread (unlike the
 * non-enumerable, shared `kind` discriminator), which the multi-space verify
 * path relies on.
 */
export type SqlSchemaTarget = 'sql' | 'postgres';

export interface SqlSchemaIRInput {
  readonly tables: Record<string, SqlTableIR | SqlTableIRInput>;
  readonly annotations?: SqlAnnotations;
}

/**
 * Root Schema IR node representing the complete database schema as
 * observed by introspection. Target-agnostic; used by both verifiers
 * (compare against intended Contract storage) and migration planners
 * (derive operations needed to reconcile).
 *
 * The constructor normalises nested `SqlTableIR` instances so
 * downstream walks see a uniform AST regardless of whether the input
 * was a plain-data literal or already-constructed class instances.
 */
export class SqlSchemaIR extends SqlSchemaIRNode {
  // Optional on the type so plain-data `SqlSchemaIR`-shaped literals (common in
  // tests and the contract-derived schema) still satisfy it without restating
  // the field; instances always carry the concrete `'sql'`. `isPostgresSchemaIR`
  // reads it — an absent value is correctly not Postgres.
  readonly nodeTarget?: SqlSchemaTarget = 'sql';
  readonly tables: Readonly<Record<string, SqlTableIR>>;
  declare readonly annotations?: SqlAnnotations;

  constructor(input: SqlSchemaIRInput) {
    super();
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([key, t]) => [
          key,
          t instanceof SqlTableIR ? t : new SqlTableIR(t),
        ]),
      ),
    );
    if (input.annotations !== undefined) this.annotations = input.annotations;
    freezeNode(this);
  }
}
