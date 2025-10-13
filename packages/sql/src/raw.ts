import { RawQueryAST, TemplatePiece, ExprRaw, Plan, Dialect } from './types';
import { compileToSQL } from './compiler';

/**
 * Raw SQL Template Atoms
 *
 * The raw SQL API provides two distinct safety levels for building SQL queries:
 *
 * ## Safe Atoms (Parameterized, Quoted, Validated)
 * These helpers provide safety guarantees and should be preferred when possible:
 *
 * - `value()` - **Parameterized values** (prevents SQL injection)
 * - `ident()` - **Quoted identifiers** (handles reserved words, special chars)
 * - `table()` - **Quoted table names**
 * - `column()` - **Quoted column references**
 * - `qualified()` - **Quoted qualified names** (schema.table)
 *
 * ## Unsafe Atoms (Raw SQL Injection)
 * These bypass safety mechanisms and should be used sparingly:
 *
 * - `unsafe()` - **Raw SQL strings** (no processing, direct injection)
 *
 * ## Safety Model
 *
 * The design follows the **"explicit unsafe"** principle:
 * - **Default**: Use safe atoms (`value`, `ident`, `table`, etc.)
 * - **Opt-in**: Use `unsafe()` when you need raw SQL
 * - **Explicit**: `unsafe()` makes it clear you're bypassing safety
 *
 * ## Usage Patterns
 *
 * ```typescript
 * // Safe parameterized query
 * rawQuery`SELECT * FROM ${table('users')} WHERE ${column('users', 'id')} = ${value(userId)}`;
 *
 * // DDL with unsafe (appropriate use)
 * rawQuery`${unsafe('CREATE SCHEMA IF NOT EXISTS public;')}`;
 *
 * // Mixed safe/unsafe
 * rawQuery`
 *   INSERT INTO ${table('users')} (email, active)
 *   VALUES (${value(email)}, true)
 *   ${unsafe('ON CONFLICT (email) DO NOTHING;')}
 * `;
 * ```
 */

// Helper types for template atoms
export interface Value {
  kind: 'value';
  v: any;
  codec?: string;
}

export interface Ident {
  kind: 'ident';
  name: string;
}

export interface Qualified {
  kind: 'qualified';
  parts: string[];
}

export interface ColumnAtom {
  kind: 'column';
  table?: string;
  name: string;
}

export interface TableAtom {
  kind: 'table';
  name: string;
}

export interface RawUnsafe {
  kind: 'rawUnsafe';
  sql: string;
}

export type RawAtom = Value | Ident | Qualified | ColumnAtom | TableAtom | RawUnsafe;

// Helper factories for safe atoms

/**
 * Creates a quoted identifier atom for safe SQL injection.
 *
 * **Safety**: Automatically quotes identifiers to handle reserved words and special characters.
 *
 * @param name - The identifier name (table, column, etc.)
 * @returns A safe identifier atom
 *
 * @example
 * ```typescript
 * rawQuery`SELECT * FROM ${ident('user')}` // → SELECT * FROM "user"
 * rawQuery`SELECT ${ident('createdAt')} FROM users` // → SELECT "createdAt" FROM users
 * ```
 */
export const ident = (name: string): Ident => ({ kind: 'ident', name });

/**
 * Creates a quoted table name atom for safe SQL injection.
 *
 * **Safety**: Automatically quotes table names to handle reserved words and special characters.
 *
 * @param name - The table name
 * @returns A safe table atom
 *
 * @example
 * ```typescript
 * rawQuery`SELECT * FROM ${table('users')}` // → SELECT * FROM "users"
 * rawQuery`INSERT INTO ${table('user')} VALUES (...)` // → INSERT INTO "user" VALUES (...)
 * ```
 */
export const table = (name: string): TableAtom => ({ kind: 'table', name });

/**
 * Creates a quoted column reference atom for safe SQL injection.
 *
 * **Safety**: Automatically quotes table and column names, handles qualified references.
 *
 * @param table - The table name (optional)
 * @param name - The column name
 * @returns A safe column atom
 *
 * @example
 * ```typescript
 * rawQuery`SELECT ${column('users', 'id')} FROM users` // → SELECT "users"."id" FROM users
 * rawQuery`WHERE ${column('users', 'email')} = ${value(email)}` // → WHERE "users"."email" = $1
 * ```
 */
export const column = (table: string, name: string): ColumnAtom => ({
  kind: 'column',
  table,
  name,
});

/**
 * Creates a quoted qualified name atom for safe SQL injection.
 *
 * **Safety**: Automatically quotes each part of a qualified name (e.g., schema.table.column).
 *
 * @param parts - Array of name parts (e.g., ['schema', 'table', 'column'])
 * @returns A safe qualified atom
 *
 * @example
 * ```typescript
 * rawQuery`SELECT * FROM ${qualified(['public', 'users'])}` // → SELECT * FROM "public"."users"
 * rawQuery`INSERT INTO ${qualified(['prisma_contract', 'version'])} VALUES (...)` // → INSERT INTO "prisma_contract"."version" VALUES (...)
 * ```
 */
export const qualified = (parts: string[]): Qualified => ({ kind: 'qualified', parts });

/**
 * Creates a parameterized value atom for safe SQL injection.
 *
 * **Safety**: Prevents SQL injection by using parameterized queries instead of string interpolation.
 *
 * @param v - The value to parameterize
 * @param codec - Optional type codec hint (e.g., 'text', 'json')
 * @returns A safe value atom
 *
 * @example
 * ```typescript
 * rawQuery`SELECT * FROM users WHERE id = ${value(userId)}` // → SELECT * FROM users WHERE id = $1
 * rawQuery`INSERT INTO users (email) VALUES (${value(email, 'text')})` // → INSERT INTO users (email) VALUES ($1)
 * ```
 */
export const value = <T>(v: T, codec?: string): Value => ({ kind: 'value', v, codec });

/**
 * Creates an unsafe raw SQL atom that bypasses safety mechanisms.
 *
 * **⚠️ WARNING**: This bypasses all safety mechanisms and can lead to SQL injection.
 * Only use when you need raw SQL that cannot be safely templated.
 *
 * **Appropriate uses**:
 * - DDL operations (CREATE TABLE, CREATE SCHEMA, etc.)
 * - Complex SQL beyond template capabilities
 * - Dynamic SQL constructed at runtime
 *
 * **Avoid**:
 * - User input without proper sanitization
 * - String interpolation with variables
 * - Any case where `value()` could be used instead
 *
 * @param sql - Raw SQL string to inject directly
 * @returns An unsafe raw SQL atom
 *
 * @example
 * ```typescript
 * // ✅ Appropriate: DDL with no parameters
 * rawQuery`${unsafe('CREATE SCHEMA IF NOT EXISTS prisma_contract;')}`
 *
 * // ✅ Appropriate: Complex SQL
 * rawQuery`
 *   ${unsafe(`
 *     CREATE TABLE IF NOT EXISTS "user" (
 *       id        SERIAL PRIMARY KEY,
 *       email     VARCHAR(255) UNIQUE NOT NULL
 *     );
 *   `)}
 * `
 *
 * // ❌ Avoid: Use value() instead
 * rawQuery`SELECT * FROM users WHERE email = ${unsafe(`'${email}'`)}` // SQL injection risk!
 *
 * // ✅ Better: Use parameterized values
 * rawQuery`SELECT * FROM users WHERE email = ${value(email)}`
 * ```
 */
export const unsafe = (sql: string): RawUnsafe => ({ kind: 'rawUnsafe', sql });

// Type guards
export function isValue(obj: any): obj is Value {
  return obj && typeof obj === 'object' && obj.kind === 'value';
}

export function isIdent(obj: any): obj is Ident {
  return obj && typeof obj === 'object' && obj.kind === 'ident';
}

export function isQualified(obj: any): obj is Qualified {
  return obj && typeof obj === 'object' && obj.kind === 'qualified';
}

export function isColumn(obj: any): obj is ColumnAtom {
  return obj && typeof obj === 'object' && obj.kind === 'column';
}

export function isTable(obj: any): obj is TableAtom {
  return obj && typeof obj === 'object' && obj.kind === 'table';
}

export function isUnsafe(obj: any): obj is RawUnsafe {
  return obj && typeof obj === 'object' && obj.kind === 'rawUnsafe';
}

// Template tag function for building RawQueryAST
/**
 * Template tag function for building RawQueryAST from template literals.
 *
 * This is the low-level function that creates a RawQueryAST. For most use cases,
 * prefer `rawQuery()` which returns a complete Plan ready for execution.
 *
 * @param strings - Template literal strings
 * @param interpolations - Raw atoms to interpolate
 * @returns A RawQueryAST that needs to be compiled
 *
 * @example
 * ```typescript
 * const ast = raw`SELECT * FROM ${table('users')} WHERE id = ${value(1)}`;
 * const { sql, params } = compileToSQL(ast);
 * ```
 */
export function raw(strings: TemplateStringsArray, ...interpolations: RawAtom[]): RawQueryAST {
  const template: TemplatePiece[] = [];

  for (let i = 0; i < strings.length; i++) {
    // Add text segment
    if (strings[i]) {
      template.push({ kind: 'text', value: strings[i] });
    }

    // Add interpolation if it exists
    if (i < interpolations.length) {
      const atom = interpolations[i];
      template.push(atom as TemplatePiece);
    }
  }

  return {
    type: 'raw',
    template,
  };
}

// Convenience function to build full Plan from template
/**
 * Convenience function to build a complete Plan from template literals.
 *
 * This is the **recommended way** to create raw SQL queries. It handles all the
 * boilerplate of creating a RawQueryAST, compiling it to SQL, and building a Plan.
 *
 * **Benefits**:
 * - Returns a complete Plan ready for `db.execute()`
 * - Handles refs extraction automatically
 * - Provides proper metadata
 * - No manual Plan construction needed
 *
 * @param strings - Template literal strings
 * @param interpolations - Raw atoms to interpolate
 * @returns A complete Plan ready for execution
 *
 * @example
 * ```typescript
 * // Simple usage - no manual Plan construction needed
 * await db.execute(rawQuery`SELECT * FROM ${table('users')} WHERE id = ${value(userId)}`);
 *
 * // DDL operations
 * await db.execute(rawQuery`${unsafe('CREATE SCHEMA IF NOT EXISTS public;')}`);
 *
 * // Mixed safe/unsafe
 * await db.execute(rawQuery`
 *   INSERT INTO ${table('users')} (email, active)
 *   VALUES (${value(email)}, true)
 *   ${unsafe('ON CONFLICT (email) DO NOTHING;')}
 * `);
 * ```
 */
export function rawQuery(
  strings: TemplateStringsArray,
  ...interpolations: RawAtom[]
): Plan<unknown> {
  const ast = raw(strings, ...interpolations);
  const { sql, params } = compileToSQL(ast);

  return {
    ast,
    sql,
    params,
    meta: {
      contractHash: '', // Unknown for raw queries
      target: 'postgres',
      refs: refsOfRaw(ast),
      annotations: { origin: 'raw' },
    },
  };
}

// Extract table and column references from raw template
/**
 * Extracts table and column references from a RawQueryAST for schema verification.
 *
 * This function analyzes the template pieces to identify which tables and columns
 * are referenced in the raw SQL query. This information is used for:
 * - Schema verification and contract hash validation
 * - Query planning and optimization
 * - Dependency tracking
 *
 * @param ast - The RawQueryAST to analyze
 * @returns Object containing arrays of referenced tables and columns
 *
 * @example
 * ```typescript
 * const ast = raw`SELECT ${column('users', 'id')} FROM ${table('users')} WHERE ${column('users', 'email')} = ${value(email)}`;
 * const refs = refsOfRaw(ast);
 * // refs.tables = ['users']
 * // refs.columns = ['users.id', 'users.email']
 * ```
 */
export function refsOfRaw(ast: RawQueryAST): { tables: string[]; columns: string[] } {
  const tables = new Set<string>();
  const columns = new Set<string>();

  for (const piece of ast.template) {
    switch (piece.kind) {
      case 'table':
        tables.add(piece.name);
        break;
      case 'column':
        if (piece.table) {
          tables.add(piece.table);
          columns.add(`${piece.table}.${piece.name}`);
        } else {
          columns.add(piece.name);
        }
        break;
      case 'qualified':
        // Qualified names like schema.table
        if (piece.parts.length >= 2) {
          tables.add(piece.parts[piece.parts.length - 1]);
        }
        break;
    }
  }

  return {
    tables: Array.from(tables),
    columns: Array.from(columns),
  };
}

// Helper to create raw expressions for embedding in normal queries
/**
 * Creates a raw SQL expression that can be embedded in normal query ASTs.
 *
 * This function creates an `ExprRaw` that can be used within regular query building
 * (e.g., in SELECT clauses, WHERE conditions, etc.) to inject raw SQL fragments.
 *
 * **Use cases**:
 * - Custom SQL functions not supported by the DSL
 * - Complex expressions that are hard to template
 * - Database-specific SQL features
 *
 * @param strings - Template literal strings
 * @param interpolations - Raw atoms to interpolate
 * @returns An ExprRaw that can be embedded in query expressions
 *
 * @example
 * ```typescript
 * // Embed raw expression in SELECT clause
 * sql.from(t.users)
 *   .select({
 *     id: t.users.id,
 *     customField: rawExpr`CASE WHEN ${column('users', 'active')} THEN 'active' ELSE 'inactive' END`
 *   });
 *
 * // Use in WHERE clause
 * sql.from(t.users)
 *   .where(rawExpr`${column('users', 'createdAt')} > NOW() - INTERVAL '30 days'`);
 * ```
 */
export function rawExpr(strings: TemplateStringsArray, ...interpolations: RawAtom[]): ExprRaw {
  const template: TemplatePiece[] = [];

  for (let i = 0; i < strings.length; i++) {
    if (strings[i]) {
      template.push({ kind: 'text', value: strings[i] });
    }

    if (i < interpolations.length) {
      const atom = interpolations[i];
      template.push(atom as TemplatePiece);
    }
  }

  return {
    kind: 'raw',
    template,
  };
}
