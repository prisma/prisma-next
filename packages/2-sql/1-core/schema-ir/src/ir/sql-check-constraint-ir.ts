import { freezeNode, IRNodeBase } from '@prisma-next/framework-components/ir';

/**
 * Input for a value-set (enum-style `IN (...)`) check constraint. Carries the
 * **resolved values** rather than a raw SQL predicate so callers can compare
 * value-sets without parsing SQL.
 */
export interface SqlValueSetCheckIRInput {
  readonly kind: 'valueSet';
  /** Constraint name as stored in the database catalog. */
  readonly name: string;
  /** Column the check restricts. */
  readonly column: string;
  /** Permitted values the column must be IN. */
  readonly permittedValues: readonly string[];
}

/**
 * Input for an expression check constraint that carries a canonical SQL
 * predicate string (e.g. the scalar-array element-non-null check
 * `array_position("tags", NULL) IS NULL`). Compared by strict string equality
 * on the canonical predicate.
 */
export interface SqlExpressionCheckIRInput {
  readonly kind: 'expression';
  /** Constraint name as stored in the database catalog. */
  readonly name: string;
  /** Canonical SQL predicate emitted verbatim into `CHECK (<expression>)`. */
  readonly expression: string;
}

/**
 * A table-level check constraint, discriminated on `kind`:
 *
 * - `valueSet` — an enum-style `column IN (...)` restriction carrying the
 *   resolved permitted values.
 * - `expression` — a canonical SQL predicate (the scalar-array
 *   element-non-null check) compared by strict string equality.
 */
export type SqlCheckConstraintIRInput = SqlValueSetCheckIRInput | SqlExpressionCheckIRInput;

/**
 * Schema IR node for a table-level check constraint.
 *
 * A leaf that earns polymorphic dispatch: value-set and expression checks are
 * switched over at the verifier, planner, and introspection sites, so the leaf
 * carries its own literal `kind` (per the `IRNodeBase` alphabet contract).
 */
export abstract class SqlCheckConstraintIR extends IRNodeBase {
  abstract override readonly kind: 'valueSet' | 'expression';
  readonly name: string;

  protected constructor(name: string) {
    super();
    this.name = name;
  }
}

/** Value-set (`column IN (...)`) check constraint. */
export class SqlValueSetCheckIR extends SqlCheckConstraintIR {
  override readonly kind = 'valueSet' as const;
  readonly column: string;
  readonly permittedValues: readonly string[];

  constructor(input: Omit<SqlValueSetCheckIRInput, 'kind'>) {
    super(input.name);
    this.column = input.column;
    this.permittedValues = Object.freeze([...input.permittedValues]);
    freezeNode(this);
  }
}

/** Expression (canonical SQL predicate) check constraint. */
export class SqlExpressionCheckIR extends SqlCheckConstraintIR {
  override readonly kind = 'expression' as const;
  readonly expression: string;

  constructor(input: Omit<SqlExpressionCheckIRInput, 'kind'>) {
    super(input.name);
    this.expression = input.expression;
    freezeNode(this);
  }
}

/** Builds the concrete check-constraint IR node for a discriminated input. */
export function sqlCheckConstraintIR(input: SqlCheckConstraintIRInput): SqlCheckConstraintIR {
  return input.kind === 'valueSet'
    ? new SqlValueSetCheckIR(input)
    : new SqlExpressionCheckIR(input);
}
