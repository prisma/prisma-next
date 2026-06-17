import { freezeNode } from '@prisma-next/framework-components/ir';
import {
  type SqlAnnotations,
  SqlSchemaIRNode,
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
export class PostgresSchemaIR extends SqlSchemaIRNode {
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
}

export function isPostgresSchemaIR(value: unknown): value is PostgresSchemaIR {
  if (value instanceof PostgresSchemaIR) return true;
  // projectSchemaToSpace spreads the IR into a plain object ({...schema, tables: pruned}).
  // The resulting object is not an instance but retains all own properties including
  // rlsPolicies. Duck-type on that to handle the multi-space verification path.
  return (
    typeof value === 'object' &&
    value !== null &&
    'rlsPolicies' in value &&
    Array.isArray((value as { rlsPolicies: unknown }).rlsPolicies)
  );
}
