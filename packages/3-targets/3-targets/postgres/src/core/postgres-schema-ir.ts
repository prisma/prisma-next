import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import {
  type SqlAnnotations,
  type SqlSchemaIR,
  SqlSchemaIRNode,
  type SqlSchemaTarget,
  SqlTableIR,
  type SqlTableIRInput,
} from '@prisma-next/sql-schema-ir/types';
import type { PostgresRlsPolicy } from './postgres-rls-policy';
import type { PostgresRole } from './postgres-role';

export interface PostgresSchemaIRInput {
  readonly tables: Record<string, SqlTableIR | SqlTableIRInput>;
  readonly pgSchemaName: string;
  readonly pgVersion: string;
  readonly rlsPolicies: readonly PostgresRlsPolicy[];
  readonly roles: readonly PostgresRole[];
  readonly existingSchemas: readonly string[];
  readonly nativeEnumTypeNames: readonly string[];
}

/**
 * Postgres-specific schema IR. Mirrors the structure of `SqlSchemaIR`
 * (same `tables` + optional `annotations` fields) and adds typed fields for
 * data the postgres adapter collects during introspection.
 *
 * Extends `SqlSchemaIRNode` directly rather than `SqlSchemaIR` because
 * `SqlSchemaIR` calls `freezeNode` in its constructor, which prevents
 * subclass field initialisation. `PostgresSchemaIR` replicates the minimal
 * `SqlSchemaIR` structure and freezes itself at the end of its own
 * constructor.
 *
 * RLS-specific fields (`rlsPolicies`, `roles`) are typed top-level fields on
 * this class — no `Reflect.get`, no untyped annotation bag access. The
 * `annotations.pg` bag is populated with only the subset the family layer
 * reads (`nativeEnumTypeNames`, `existingSchemas`, `schema`) so family-layer
 * PSL inference and namespace verification continue to work without knowing
 * about RLS.
 *
 * Nothing RLS-specific leaks into the sql-family layer.
 */
export class PostgresSchemaIR extends SqlSchemaIRNode implements DiffableNode {
  readonly nodeTarget: SqlSchemaTarget = 'postgres';
  readonly tables: Readonly<Record<string, SqlTableIR>>;
  declare readonly annotations?: SqlAnnotations;
  readonly pgSchemaName: string;
  readonly pgVersion: string;
  readonly rlsPolicies: readonly PostgresRlsPolicy[];
  readonly roles: readonly PostgresRole[];
  readonly existingSchemas: readonly string[];
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresSchemaIRInput) {
    super();
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([key, t]) => [
          key,
          t instanceof SqlTableIR ? t : new SqlTableIR(t),
        ]),
      ),
    );
    this.pgSchemaName = input.pgSchemaName;
    this.pgVersion = input.pgVersion;
    this.rlsPolicies = Object.freeze([...input.rlsPolicies]);
    this.roles = Object.freeze([...input.roles]);
    this.existingSchemas = Object.freeze([...input.existingSchemas]);
    this.nativeEnumTypeNames = Object.freeze([...input.nativeEnumTypeNames]);
    // Populate the annotations.pg bag with only the subset the family layer
    // reads (nativeEnumTypeNames for PSL inference, existingSchemas for
    // namespace presence checks). rlsPolicies and roles are NOT placed here
    // — they are consumed directly via typed fields on this class.
    this.annotations = {
      pg: {
        schema: input.pgSchemaName,
        ...(input.nativeEnumTypeNames.length > 0 && {
          nativeEnumTypeNames: input.nativeEnumTypeNames,
        }),
        ...(input.existingSchemas.length > 0 && {
          existingSchemas: input.existingSchemas,
        }),
      },
    };
    freezeNode(this);
  }

  /** Stable id for the differ. The schema name identifies this database root. */
  id(): string {
    return this.pgSchemaName;
  }

  // No database-level attributes to compare yet; two database roots from the
  // same derivation are structurally identical at this level.
  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return this.rlsPolicies;
  }
}

/**
 * Structural guard for `PostgresSchemaIR`, narrowing on the `nodeTarget`
 * discriminant rather than `instanceof`. `nodeTarget` is an enumerable own field
 * (a plain class-field initializer), so it survives the `{ ...schema, tables }`
 * spread the multi-space verify path (`projectSchemaToSpace`) produces — that
 * projected object is not a class instance but retains every enumerable own
 * property. The family-level `kind = 'sql-schema-ir'` discriminator is unusable
 * here: it is shared by every SQL schema-IR node and is non-enumerable (dropped
 * by the spread).
 */
export function isPostgresSchemaIR(schema: SqlSchemaIR): schema is PostgresSchemaIR {
  return schema.nodeTarget === 'postgres';
}
