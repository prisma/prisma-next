/**
 * Core schema view types for family-agnostic schema visualization.
 *
 * These types provide a minimal, generic, tree-shaped representation of schemas
 * across families, designed for CLI visualization and lightweight tooling.
 *
 * Families can optionally project their family-specific Schema IR into this
 * core view via the `toSchemaView` method on `FamilyInstance`.
 *
 * ## Example: SQL Family Mapping
 *
 * For the SQL family, `SqlSchemaIR` can be mapped to `CoreSchemaView` as follows:
 *
 * ```ts
 * // SqlSchemaIR structure:
 * // {
 * //   tables: { user: { columns: {...}, primaryKey: {...}, ... }, ... },
 * //   extensions: ['pgvector'],
 * //   annotations: {...}
 * // }
 *
 * // CoreSchemaView mapping:
 * // {
 * //   root: {
 * //     kind: 'root',
 * //     id: 'sql-schema',
 * //     label: 'sql schema (tables: 2)',
 * //     children: [
 * //       {
 * //         kind: 'entity',
 * //         id: 'table-user',
 * //         label: 'table user',
 * //         meta: { primaryKey: ['id'], ... },
 * //         children: [
 * //           {
 * //             kind: 'field',
 * //             id: 'column-id',
 * //             label: 'id: pg/int4@1 (not null)',
 * //             meta: { nativeType: 'pg/int4@1', nullable: false, ... }
 * //           },
 * //           {
 * //             kind: 'index',
 * //             id: 'index-user-email',
 * //             label: 'index user_email_unique',
 * //             meta: { columns: ['email'], unique: true, ... }
 * //           }
 * //         ]
 * //       },
 * //       {
 * //         kind: 'extension',
 * //         id: 'extension-pgvector',
 * //         label: 'extension pgvector',
 * //         meta: { ... }
 * //       }
 * //     ]
 * //   }
 * // }
 * ```
 *
 * This mapping demonstrates that the core view types are expressive enough
 * to represent SQL schemas without being SQL-specific.
 */

/**
 * Node kinds for schema tree nodes.
 * Designed to be generic enough for SQL, document, KV, and future families.
 */
export type SchemaNodeKind =
  | 'root'
  | 'namespace'
  | 'collection'
  | 'entity'
  | 'field'
  | 'index'
  | 'extension';

/**
 * A node in the schema tree.
 * Tree-shaped structure good for Command Tree-style CLI output.
 */
export interface SchemaTreeNode {
  readonly kind: SchemaNodeKind;
  readonly id: string;
  readonly label: string;
  readonly meta?: Record<string, unknown>;
  readonly children?: readonly SchemaTreeNode[];
}

/**
 * Core schema view providing a family-agnostic tree representation of a schema.
 * Used by CLI and cross-family tooling for visualization.
 */
export interface CoreSchemaView {
  readonly root: SchemaTreeNode;
}
