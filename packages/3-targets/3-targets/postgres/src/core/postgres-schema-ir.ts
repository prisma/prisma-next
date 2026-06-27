import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import {
  type SqlAnnotations,
  type SqlSchemaIR,
  SqlSchemaIRNode,
  type SqlSchemaTarget,
  type SqlTableIRInput,
} from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { PostgresRlsPolicy } from './postgres-rls-policy';
import type { PostgresRole } from './postgres-role';
import { PostgresTableIR } from './postgres-table-ir';

export interface PostgresSchemaIRInput {
  readonly tables: Record<
    string,
    PostgresTableIR | (SqlTableIRInput & { rlsPolicies?: readonly PostgresRlsPolicy[] })
  >;
  readonly pgSchemaName: string;
  readonly pgVersion: string;
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
 * `tables` holds `PostgresTableIR` instances which carry their own RLS
 * policies. `children()` returns the tables directly — the table instances
 * ARE the diff-tree nodes.
 *
 * Nothing RLS-specific leaks into the sql-family layer.
 */
export class PostgresSchemaIR extends SqlSchemaIRNode implements DiffableNode {
  readonly nodeTarget: SqlSchemaTarget = 'postgres';
  readonly tables: Readonly<Record<string, PostgresTableIR>>;
  declare readonly annotations?: SqlAnnotations;
  readonly pgSchemaName: string;
  readonly pgVersion: string;
  readonly roles: readonly PostgresRole[];
  readonly existingSchemas: readonly string[];
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresSchemaIRInput) {
    super();
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([key, t]) => [
          key,
          t instanceof PostgresTableIR ? t : new PostgresTableIR(t),
        ]),
      ),
    );
    this.pgSchemaName = input.pgSchemaName;
    this.pgVersion = input.pgVersion;
    this.roles = Object.freeze([...input.roles]);
    this.existingSchemas = Object.freeze([...input.existingSchemas]);
    this.nativeEnumTypeNames = Object.freeze([...input.nativeEnumTypeNames]);
    // Populate the annotations.pg bag with only the subset the family layer
    // reads (nativeEnumTypeNames for PSL inference, existingSchemas for
    // namespace presence checks).
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

  get id(): string {
    return this.pgSchemaName;
  }

  get rlsPolicies(): readonly PostgresRlsPolicy[] {
    return Object.values(this.tables).flatMap((t) => t.rlsPolicies);
  }

  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return Object.values(this.tables);
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

export function assertPostgresSchemaIR(schema: SqlSchemaIR): asserts schema is PostgresSchemaIR {
  if (!isPostgresSchemaIR(schema)) {
    throw new Error(
      `planPostgresSchemaDiff: expected a PostgresSchemaIR but got nodeTarget=${String(schema.nodeTarget ?? typeof schema)}`,
    );
  }
}

/**
 * Returns `schema` as-is when it is a real `PostgresSchemaIR` instance, or
 * reconstructs one when `projectSchemaToSpace` has spread the class into a
 * plain object (losing prototype methods).
 */
export function ensurePostgresSchemaIR(schema: PostgresSchemaIR): PostgresSchemaIR {
  if (schema instanceof PostgresSchemaIR) return schema;
  return new PostgresSchemaIR(
    blindCast<
      PostgresSchemaIRInput,
      'spread objects from projectSchemaToSpace preserve all own-enumerable fields'
    >(schema),
  );
}
